import { Router } from 'express';
import { createStockTransferSchema, paginationSchema, uuidSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireModule } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { conflict, notFound, unprocessable } from '../../shared/errors.js';
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
          const inv = await tx.query<{ quantity: number }>(
            `select bi.quantity::float8 as quantity from branch_inventory bi
             where bi.organization_id=$1 and bi.branch_id=$2 and bi.product_id=$3`,
            [organizationId, input.fromBranchId, item.productId],
          );

          const currentQty = inv.rows[0]?.quantity ?? 0;
          if (!allowNegative && currentQty < item.quantity) {
            throw unprocessable('INSUFFICIENT_STOCK', `Insufficient inventory at source branch.`);
          }

          // Deduct from sender branch inventory
          await tx.query(
            `insert into branch_inventory (organization_id, branch_id, product_id, quantity, average_cost, inventory_value)
             values ($1, $2, $3, -$4, 0, 0)
             on conflict (organization_id, branch_id, product_id) do update set
               quantity = branch_inventory.quantity - $4,
               inventory_value = round(branch_inventory.average_cost * (branch_inventory.quantity - $4), 4),
               updated_at = now()`,
            [organizationId, input.fromBranchId, item.productId, item.quantity],
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
              item.quantity,
              currentQty - item.quantity,
              `Stock transfer out ${transferNumber}`,
              userId,
            ],
          );
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
            `insert into stock_transfer_items (organization_id, stock_transfer_id, product_id, quantity)
             values ($1, $2, $3, $4)`,
            [organizationId, transferId, item.productId, item.quantity],
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

      const itemsRes = await tx.query<{ product_id: string; quantity: number }>(
        `select product_id, quantity::float8 as quantity from stock_transfer_items
         where stock_transfer_id = $1 and organization_id = $2`,
        [id, organizationId],
      );

      for (const item of itemsRes.rows) {
        // Fetch current destination quantity
        const invRes = await tx.query<{ quantity: number }>(
          `select quantity::float8 as quantity from branch_inventory
           where organization_id = $1 and branch_id = $2 and product_id = $3`,
          [organizationId, transfer.to_branch_id, item.product_id],
        );
        const currentQty = invRes.rows[0]?.quantity ?? 0;

        // Add to destination inventory
        await tx.query(
          `insert into branch_inventory (organization_id, branch_id, product_id, quantity, average_cost, inventory_value)
           values ($1, $2, $3, $4, 0, 0)
           on conflict (organization_id, branch_id, product_id) do update set
             quantity = branch_inventory.quantity + $4,
             inventory_value = round(branch_inventory.average_cost * (branch_inventory.quantity + $4), 4),
             updated_at = now()`,
          [organizationId, transfer.to_branch_id, item.product_id, item.quantity],
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
            item.quantity,
            currentQty + item.quantity,
            `Received stock transfer ${transfer.transfer_number}`,
            userId,
          ],
        );
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

      const itemsRes = await tx.query<{ product_id: string; quantity: number }>(
        `select product_id, quantity::float8 as quantity from stock_transfer_items
         where stock_transfer_id = $1 and organization_id = $2`,
        [id, organizationId],
      );

      for (const item of itemsRes.rows) {
        // Restore stock to sender branch
        await tx.query(
          `insert into branch_inventory (organization_id, branch_id, product_id, quantity, average_cost, inventory_value)
           values ($1, $2, $3, $4, 0, 0)
           on conflict (organization_id, branch_id, product_id) do update set
             quantity = branch_inventory.quantity + $4,
             inventory_value = round(branch_inventory.average_cost * (branch_inventory.quantity + $4), 4),
             updated_at = now()`,
          [organizationId, transfer.from_branch_id, item.product_id, item.quantity],
        );
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
