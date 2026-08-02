import { Router } from 'express';
import { createStockTransferSchema, paginationSchema, uuidSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireModule } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { badRequest, conflict, notFound, unprocessable } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';

export function stockTransfersRouter(database: Database): Router {
  const router = Router();

  // Enforce SaaS module enablement flag!
  router.use(requireModule('stock_transfers'));

  // GET /stock-transfers -> List transfers
  router.get(
    '/',
    validateQuery(
      paginationSchema.extend({
        branchId: uuidSchema.optional(),
        status: uuidSchema.optional(),
      }),
    ),
    async (request, response) => {
      const { branchId, status, page, pageSize, search } = request.query as any;
      const organizationId = request.authUser!.organization.id;

      const result = await database.query(
        `select st.id, st.transfer_number as "transferNumber", st.status,
          st.notes, st.created_at as "createdAt", st.completed_at as "completedAt",
          fb.name as "fromBranchName", tb.name as "toBranchName",
          p.display_name as "createdByName",
          count(*) over()::int as total
         from stock_transfers st
         join branches fb on fb.id = st.from_branch_id
         join branches tb on tb.id = st.to_branch_id
         join profiles p on p.id = st.created_by
         where st.organization_id = $1
           and ($2::uuid is null or st.from_branch_id = $2 or st.to_branch_id = $2)
           and ($3::text is null or st.status = $3)
           and ($4::text is null or st.transfer_number ilike '%'||$4||'%' or fb.name ilike '%'||$4||'%' or tb.name ilike '%'||$4||'%')
         order by st.created_at desc limit $5 offset $6`,
        [
          organizationId,
          branchId ?? null,
          status ?? null,
          search ?? null,
          pageSize,
          (page - 1) * pageSize,
        ],
      );

      const total = result.rows[0]?.total ?? 0;
      sendPage(
        response,
        result.rows.map(({ total: _total, ...row }) => row),
        page,
        pageSize,
        total,
      );
    },
  );

  // GET /stock-transfers/:id -> Get transfer details
  router.get('/:id', async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;

    const transferResult = await database.query(
      `select st.id, st.transfer_number as "transferNumber", st.status,
        st.notes, st.created_at as "createdAt", st.completed_at as "completedAt",
        st.cancelled_at as "cancelledAt",
        st.from_branch_id as "fromBranchId", fb.name as "fromBranchName",
        st.to_branch_id as "toBranchId", tb.name as "toBranchName",
        cp.display_name as "createdByName",
        rec.display_name as "completedByName"
       from stock_transfers st
       join branches fb on fb.id = st.from_branch_id
       join branches tb on tb.id = st.to_branch_id
       join profiles cp on cp.id = st.created_by
       left join profiles rec on rec.id = st.completed_by
       where st.id = $1 and st.organization_id = $2`,
      [id, organizationId],
    );

    if (!transferResult.rows[0]) throw notFound('Stock transfer');

    const itemsResult = await database.query(
      `select sti.id, sti.product_id as "productId", sti.quantity::float8 as quantity,
        sti.base_quantity::float8 as "baseQuantity",sti.stock_pool as pool,
        sti.container_variant_id as "containerVariantId",
        p.name as "productName", p.sku, p.unit
       from stock_transfer_items sti
       join products p on p.id = sti.product_id
       where sti.stock_transfer_id = $1 and sti.organization_id = $2`,
      [id, organizationId],
    );

    sendData(response, {
      ...transferResult.rows[0],
      items: itemsResult.rows,
    });
  });

  // POST /stock-transfers -> Dispatch stock transfer
  router.post(
    '/',
    validateBody(createStockTransferSchema),
    async (request, response) => {
      const input = request.body;
      const organizationId = request.authUser!.organization.id;
      const userId = request.authUser!.id;

      const transfer = await database.transaction(async (tx) => {
        // Generate transfer number
        const seqResult = await tx.query<{ seq: string }>(
          "select nextval('stock_transfer_number_seq')::text as seq",
        );
        const seqStr = seqResult.rows[0]!.seq.padStart(6, '0');
        const transferNumber = `TRF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${seqStr}`;

        // Check allow_negative_inventory setting
        const settings = await tx.query<{ allow_negative_inventory: boolean }>(
          'select allow_negative_inventory from organization_settings where organization_id=$1',
          [organizationId],
        );
        const allowNegative = settings.rows[0]?.allow_negative_inventory ?? false;

        // Deduct inventory from source branch for each item
        for (const item of input.items) {
          const inv = await tx.query<{
            quantity: number;
            sealedQuantity: number;
            openedQuantity: number;
            portioningVariantId: string | null;
            unitsPerBase: number | null;
          }>(
            `select coalesce(bi.quantity,0)::float8 as quantity,
              coalesce(bi.sealed_quantity,0)::float8 as "sealedQuantity",
              coalesce(bi.opened_quantity,0)::float8 as "openedQuantity",
              pv.id as "portioningVariantId",pv.units_per_base::float8 as "unitsPerBase"
             from products p
             left join branch_inventory bi on bi.organization_id=p.organization_id
               and bi.branch_id=$2 and bi.product_id=p.id and bi.variant_id is null
             left join product_variants pv on pv.organization_id=p.organization_id
               and pv.product_id=p.id and pv.is_portioning_container
             where p.organization_id=$1 and p.id=$3`,
            [organizationId, input.fromBranchId, item.productId],
          );
          const stock = inv.rows[0];
          if (!stock) throw notFound('Product');
          const isPortioning = Boolean(stock.portioningVariantId);
          if (isPortioning && item.pool === 'shared') {
            throw badRequest(
              'STOCK_POOL_REQUIRED',
              'Choose whether to transfer sealed containers or opened portion stock',
            );
          }
          if (!isPortioning && item.pool !== 'shared') {
            throw badRequest('INVALID_STOCK_POOL', 'This product uses one shared stock balance');
          }
          if (item.pool === 'sealed' && !Number.isInteger(item.quantity)) {
            throw badRequest('WHOLE_CONTAINER_REQUIRED', 'Sealed containers must be whole numbers');
          }
          const baseQuantity =
            item.pool === 'sealed' ? item.quantity * Number(stock.unitsPerBase) : item.quantity;
          const currentPoolQuantity =
            item.pool === 'sealed'
              ? stock.sealedQuantity
              : item.pool === 'opened'
                ? stock.openedQuantity
                : stock.quantity;
          if (!allowNegative && currentPoolQuantity < item.quantity) {
            throw unprocessable(
              'INSUFFICIENT_STOCK',
              `Insufficient ${item.pool === 'shared' ? '' : `${item.pool} `}inventory at source branch.`,
            );
          }

          // Deduct from sender branch inventory
          const updatedInventory = await tx.query<{
            sealedQuantity: number;
            openedQuantity: number;
          }>(
            `insert into branch_inventory (
               organization_id,branch_id,product_id,quantity,average_cost,inventory_value,
               sealed_quantity,opened_quantity
             ) values ($1,$2,$3,-$4,0,0,-$5,-$6)
             on conflict (branch_id,product_id,variant_id) do update set
               quantity = branch_inventory.quantity - $4,
               sealed_quantity = branch_inventory.sealed_quantity - $5,
               opened_quantity = branch_inventory.opened_quantity - $6,
               inventory_value = round(branch_inventory.average_cost * (branch_inventory.quantity - $4), 4),
               updated_at = now()
             returning sealed_quantity::float8 as "sealedQuantity",
               opened_quantity::float8 as "openedQuantity"`,
            [
              organizationId,
              input.fromBranchId,
              item.productId,
              baseQuantity,
              item.pool === 'sealed' ? item.quantity : 0,
              item.pool === 'opened' ? item.quantity : 0,
            ],
          );

          // Record sender movement
          await tx.query(
            `insert into inventory_movements (
               organization_id, branch_id, product_id, movement_type, quantity_delta, quantity_after, reason, created_by
             ) values ($1, $2, $3, 'stock_transfer_out', -$4, $5, $6, $7)`,
            [
              organizationId,
              input.fromBranchId,
              item.productId,
              baseQuantity,
              stock.quantity - baseQuantity,
              `Stock transfer out ${transferNumber}`,
              userId,
            ],
          );
          if (isPortioning) {
            await tx.query(
              `insert into inventory_pool_movements (
                organization_id,branch_id,product_id,container_variant_id,movement_type,
                sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
                opened_quantity_after,reason,reference_type,created_by
               ) values ($1,$2,$3,$4,'stock_transfer_out',$5,$6,$7,$8,$9,'stock_transfer',$10)`,
              [
                organizationId,
                input.fromBranchId,
                item.productId,
                stock.portioningVariantId,
                item.pool === 'sealed' ? -item.quantity : 0,
                item.pool === 'opened' ? -item.quantity : 0,
                updatedInventory.rows[0]!.sealedQuantity,
                updatedInventory.rows[0]!.openedQuantity,
                `Stock transfer out ${transferNumber}`,
                userId,
              ],
            );
          }
        }

        // Insert stock transfer header
        const stRes = await tx.query<{ id: string }>(
          `insert into stock_transfers (
             organization_id, from_branch_id, to_branch_id, transfer_number, status, notes, created_by
           ) values ($1, $2, $3, $4, 'in_transit', $5, $6)
           returning id`,
          [
            organizationId,
            input.fromBranchId,
            input.toBranchId,
            transferNumber,
            input.notes ?? null,
            userId,
          ],
        );
        const transferId = stRes.rows[0]!.id;

        // Insert transfer items
        for (const item of input.items) {
          await tx.query(
            `insert into stock_transfer_items (
               organization_id,stock_transfer_id,product_id,quantity,base_quantity,stock_pool,
               container_variant_id
             )
             select $1,$2,$3,$4,
               case when $5='sealed' then $4*pv.units_per_base else $4 end,$5,pv.id
             from products p
             left join product_variants pv on pv.organization_id=p.organization_id
               and pv.product_id=p.id and pv.is_portioning_container
             where p.organization_id=$1 and p.id=$3`,
            [organizationId, transferId, item.productId, item.quantity, item.pool],
          );
        }

        return { id: transferId, transferNumber, status: 'in_transit' };
      });

      sendData(response, transfer, 201);
    },
  );

  // POST /stock-transfers/:id/receive -> Receive transfer at target branch
  router.post('/:id/receive', async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;
    const userId = request.authUser!.id;

    await database.transaction(async (tx) => {
      const stRes = await tx.query<{
        id: string;
        to_branch_id: string;
        transfer_number: string;
        status: string;
      }>(
        `select id, to_branch_id, transfer_number, status
         from stock_transfers where id = $1 and organization_id = $2 for update`,
        [id, organizationId],
      );

      const transfer = stRes.rows[0];
      if (!transfer) throw notFound('Stock transfer');
      if (transfer.status !== 'in_transit') {
        throw conflict('TRANSFER_NOT_IN_TRANSIT', `Transfer is already ${transfer.status}`);
      }

      const itemsRes = await tx.query<{
        product_id: string;
        quantity: number;
        base_quantity: number;
        stock_pool: 'shared' | 'sealed' | 'opened';
        container_variant_id: string | null;
      }>(
        `select product_id,quantity::float8 as quantity,base_quantity::float8 as base_quantity,
           stock_pool,container_variant_id from stock_transfer_items
         where stock_transfer_id = $1 and organization_id = $2`,
        [id, organizationId],
      );

      for (const item of itemsRes.rows) {
        // Fetch current destination quantity
        const invRes = await tx.query<{
          quantity: number;
          sealedQuantity: number;
          openedQuantity: number;
        }>(
          `select quantity::float8 as quantity,sealed_quantity::float8 as "sealedQuantity",
             opened_quantity::float8 as "openedQuantity" from branch_inventory
           where organization_id = $1 and branch_id = $2 and product_id = $3
             and variant_id is null`,
          [organizationId, transfer.to_branch_id, item.product_id],
        );
        const currentQty = invRes.rows[0]?.quantity ?? 0;

        // Add to destination inventory
        const updatedInventory = await tx.query<{
          sealedQuantity: number;
          openedQuantity: number;
        }>(
          `insert into branch_inventory (
             organization_id,branch_id,product_id,quantity,average_cost,inventory_value,
             sealed_quantity,opened_quantity
           ) values ($1,$2,$3,$4,0,0,$5,$6)
           on conflict (branch_id,product_id,variant_id) do update set
             quantity = branch_inventory.quantity + $4,
             sealed_quantity = branch_inventory.sealed_quantity + $5,
             opened_quantity = branch_inventory.opened_quantity + $6,
             inventory_value = round(branch_inventory.average_cost * (branch_inventory.quantity + $4), 4),
             updated_at = now()
           returning sealed_quantity::float8 as "sealedQuantity",
             opened_quantity::float8 as "openedQuantity"`,
          [
            organizationId,
            transfer.to_branch_id,
            item.product_id,
            item.base_quantity,
            item.stock_pool === 'sealed' ? item.quantity : 0,
            item.stock_pool === 'opened' ? item.quantity : 0,
          ],
        );

        // Record destination movement
        await tx.query(
          `insert into inventory_movements (
             organization_id, branch_id, product_id, movement_type, quantity_delta, quantity_after, reason, created_by
           ) values ($1, $2, $3, 'stock_transfer_in', $4, $5, $6, $7)`,
          [
            organizationId,
            transfer.to_branch_id,
            item.product_id,
            item.base_quantity,
            currentQty + item.base_quantity,
            `Received stock transfer ${transfer.transfer_number}`,
            userId,
          ],
        );
        if (item.stock_pool !== 'shared') {
          await tx.query(
            `insert into inventory_pool_movements (
              organization_id,branch_id,product_id,container_variant_id,movement_type,
              sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
              opened_quantity_after,reason,reference_type,reference_id,created_by
             ) values ($1,$2,$3,$4,'stock_transfer_in',$5,$6,$7,$8,$9,'stock_transfer',$10,$11)`,
            [
              organizationId,
              transfer.to_branch_id,
              item.product_id,
              item.container_variant_id,
              item.stock_pool === 'sealed' ? item.quantity : 0,
              item.stock_pool === 'opened' ? item.quantity : 0,
              updatedInventory.rows[0]!.sealedQuantity,
              updatedInventory.rows[0]!.openedQuantity,
              `Received stock transfer ${transfer.transfer_number}`,
              id,
              userId,
            ],
          );
        }
      }

      // Mark completed
      await tx.query(
        `update stock_transfers set status = 'completed', completed_by = $3, completed_at = now(), updated_at = now()
         where id = $1 and organization_id = $2`,
        [id, organizationId, userId],
      );
    });

    sendData(response, { message: 'Stock transfer received successfully' });
  });

  // POST /stock-transfers/:id/cancel -> Cancel transfer & restore stock to sender
  router.post('/:id/cancel', async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;
    const userId = request.authUser!.id;

    await database.transaction(async (tx) => {
      const stRes = await tx.query<{
        id: string;
        from_branch_id: string;
        transfer_number: string;
        status: string;
      }>(
        `select id, from_branch_id, transfer_number, status
         from stock_transfers where id = $1 and organization_id = $2 for update`,
        [id, organizationId],
      );

      const transfer = stRes.rows[0];
      if (!transfer) throw notFound('Stock transfer');
      if (transfer.status !== 'in_transit') {
        throw conflict('TRANSFER_NOT_IN_TRANSIT', `Transfer is already ${transfer.status}`);
      }

      const itemsRes = await tx.query<{
        product_id: string;
        quantity: number;
        base_quantity: number;
        stock_pool: 'shared' | 'sealed' | 'opened';
        container_variant_id: string | null;
      }>(
        `select product_id,quantity::float8 as quantity,base_quantity::float8 as base_quantity,
           stock_pool,container_variant_id from stock_transfer_items
         where stock_transfer_id = $1 and organization_id = $2`,
        [id, organizationId],
      );

      for (const item of itemsRes.rows) {
        // Restore stock to sender branch
        const restoredInventory = await tx.query<{
          sealedQuantity: number;
          openedQuantity: number;
        }>(
          `insert into branch_inventory (
             organization_id,branch_id,product_id,quantity,average_cost,inventory_value,
             sealed_quantity,opened_quantity
           ) values ($1,$2,$3,$4,0,0,$5,$6)
           on conflict (branch_id,product_id,variant_id) do update set
             quantity = branch_inventory.quantity + $4,
             sealed_quantity = branch_inventory.sealed_quantity + $5,
             opened_quantity = branch_inventory.opened_quantity + $6,
             inventory_value = round(branch_inventory.average_cost * (branch_inventory.quantity + $4), 4),
             updated_at = now()
           returning sealed_quantity::float8 as "sealedQuantity",
             opened_quantity::float8 as "openedQuantity"`,
          [
            organizationId,
            transfer.from_branch_id,
            item.product_id,
            item.base_quantity,
            item.stock_pool === 'sealed' ? item.quantity : 0,
            item.stock_pool === 'opened' ? item.quantity : 0,
          ],
        );
        if (item.stock_pool !== 'shared') {
          await tx.query(
            `insert into inventory_pool_movements (
              organization_id,branch_id,product_id,container_variant_id,movement_type,
              sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
              opened_quantity_after,reason,reference_type,reference_id,created_by
             ) values ($1,$2,$3,$4,'stock_transfer_in',$5,$6,$7,$8,$9,'stock_transfer',$10,$11)`,
            [
              organizationId,
              transfer.from_branch_id,
              item.product_id,
              item.container_variant_id,
              item.stock_pool === 'sealed' ? item.quantity : 0,
              item.stock_pool === 'opened' ? item.quantity : 0,
              restoredInventory.rows[0]!.sealedQuantity,
              restoredInventory.rows[0]!.openedQuantity,
              `Cancelled stock transfer ${transfer.transfer_number}`,
              id,
              userId,
            ],
          );
        }
      }

      // Mark cancelled
      await tx.query(
        `update stock_transfers set status = 'cancelled', cancelled_by = $3, cancelled_at = now(), updated_at = now()
         where id = $1 and organization_id = $2`,
        [id, organizationId, userId],
      );
    });

    sendData(response, { message: 'Stock transfer cancelled' });
  });

  return router;
}
