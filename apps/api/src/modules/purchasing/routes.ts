import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  minorToMoney,
  moneyToMinor,
  paginationSchema,
  purchaseOrderSchema,
  purchaseReturnSchema,
  receivePurchaseOrderSchema,
  supplierInvoiceSchema,
  supplierPaymentSchema,
  supplierRefundSchema,
  supplierSchema,
  uuidSchema,
} from '@ximo/shared';
import type { Database, Queryable } from '../../database/types.js';
import {
  requireAnyModule,
  requireBranchAccess,
  requireModule,
  requirePermission,
} from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import {
  exceedsAvailable,
  purchaseLineAmount,
  purchaseQuantityToBase,
  purchaseReturnTotal,
  remainingToReceive,
  remainingToReturn,
} from '../../purchasing/quantity-service.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';

function assertBranchAccess(request: Request, branchId: string) {
  if (!request.authUser?.branches.some((branch) => branch.id === branchId)) {
    throw forbidden('BRANCH_ACCESS_DENIED', 'You do not have access to this branch');
  }
}

async function audit(
  tx: Queryable,
  input: {
    organizationId: string;
    branchId?: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    data?: unknown;
  },
) {
  await tx.query(
    `insert into audit_logs (
      organization_id,branch_id,actor_id,action,entity_type,entity_id,after_data
     ) values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      input.organizationId,
      input.branchId ?? null,
      input.actorId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.data ?? {}),
    ],
  );
}

export function suppliersRouter(database: Database): Router {
  const router = Router();
  router.use(requireAnyModule('suppliers', 'purchasing'));
  router.get(
    '/',
    requirePermission('suppliers:read', 'purchasing:read'),
    async (request, response) => {
      const result = await database.query(
        `select s.id,s.name,s.contact_name as "contactName",s.email,s.phone,s.address,
          s.tax_id as "taxId",s.notes,s.is_active as "isActive",
          count(po.id)::int as "orderCount",
          coalesce(sum(po.subtotal) filter (where po.status <> 'cancelled'),0)::text as "orderedTotal"
         from suppliers s
         left join purchase_orders po
           on po.supplier_id=s.id and po.organization_id=s.organization_id
         where s.organization_id=$1
         group by s.id order by s.is_active desc,s.name`,
        [request.authUser!.organization.id],
      );
      sendData(response, result.rows);
    },
  );
  router.post(
    '/',
    requirePermission('suppliers:manage'),
    validateBody(supplierSchema),
    async (request, response) => {
      const input = request.body;
      const organizationId = request.authUser!.organization.id;
      const result = await database.query(
        `insert into suppliers (
          organization_id,name,contact_name,email,phone,address,tax_id,notes,is_active
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id,name,contact_name as "contactName",email,phone,address,
           tax_id as "taxId",notes,is_active as "isActive"`,
        [
          organizationId,
          input.name,
          input.contactName ?? null,
          input.email ?? null,
          input.phone ?? null,
          input.address ?? null,
          input.taxId ?? null,
          input.notes ?? null,
          input.isActive,
        ],
      );
      const supplier = result.rows[0]!;
      await audit(database, {
        organizationId,
        actorId: request.authUser!.id,
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: supplier.id,
        data: input,
      });
      sendData(response, supplier, 201);
    },
  );
  router.patch(
    '/:id',
    requirePermission('suppliers:manage'),
    validateBody(supplierSchema.partial()),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const existing = await database.query<any>(
        'select * from suppliers where id=$1 and organization_id=$2',
        [id, organizationId],
      );
      if (!existing.rows[0]) throw notFound('Supplier');
      const input = {
        name: existing.rows[0].name,
        contactName: existing.rows[0].contact_name,
        email: existing.rows[0].email,
        phone: existing.rows[0].phone,
        address: existing.rows[0].address,
        taxId: existing.rows[0].tax_id,
        notes: existing.rows[0].notes,
        isActive: existing.rows[0].is_active,
        ...request.body,
      };
      const result = await database.query(
        `update suppliers set name=$3,contact_name=$4,email=$5,phone=$6,address=$7,
          tax_id=$8,notes=$9,is_active=$10,updated_at=now()
         where id=$1 and organization_id=$2
         returning id,name,contact_name as "contactName",email,phone,address,
           tax_id as "taxId",notes,is_active as "isActive"`,
        [
          id,
          organizationId,
          input.name,
          input.contactName ?? null,
          input.email ?? null,
          input.phone ?? null,
          input.address ?? null,
          input.taxId ?? null,
          input.notes ?? null,
          input.isActive,
        ],
      );
      await audit(database, {
        organizationId,
        actorId: request.authUser!.id,
        action: 'supplier.updated',
        entityType: 'supplier',
        entityId: id,
        data: input,
      });
      sendData(response, result.rows[0]);
    },
  );
  return router;
}

interface PurchaseOrderRow {
  id: string;
  branch_id: string;
  supplier_id: string;
  status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';
}

export function purchasingRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('purchasing'));
  router.get(
    '/',
    requirePermission('purchasing:read'),
    requireBranchAccess('query'),
    validateQuery(
      paginationSchema.extend({
        branchId: uuidSchema,
        returnable: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      }),
    ),
    async (request, response) => {
      const { branchId, page, pageSize, search, returnable } = request.query as any;
      const result = await database.query(
        `select po.id,po.order_number as "orderNumber",po.status,po.subtotal::text,
          po.expected_at as "expectedAt",po.created_at as "createdAt",
          s.id as "supplierId",s.name as "supplierName",b.name as "branchName",
          coalesce(sum(poi.ordered_quantity),0)::float8 as "orderedQuantity",
          coalesce(sum(poi.received_quantity),0)::float8 as "receivedQuantity",
          coalesce(sum(poi.returned_quantity),0)::float8 as "returnedQuantity",
          coalesce(sum(poi.received_quantity-poi.returned_quantity),0)::float8
            as "returnableQuantity",
          coalesce((
            select sum(si.total-si.paid_amount) from supplier_invoices si
            where si.purchase_order_id=po.id and si.organization_id=po.organization_id
              and si.status not in ('credited','void')
          ),0)::text as "outstandingBalance",
          (select count(*)::int from supplier_invoices si
            where si.purchase_order_id=po.id and si.organization_id=po.organization_id)
            as "invoiceCount",
          count(*) over()::int as total
         from purchase_orders po
         join suppliers s on s.id=po.supplier_id and s.organization_id=po.organization_id
         join branches b on b.id=po.branch_id and b.organization_id=po.organization_id
         left join purchase_order_items poi
           on poi.purchase_order_id=po.id and poi.organization_id=po.organization_id
         where po.organization_id=$1 and po.branch_id=$2
           and ($3::text is null or po.order_number ilike '%'||$3||'%'
             or s.name ilike '%'||$3||'%')
         group by po.id,s.id,b.id
         having (not $6::boolean
           or coalesce(sum(poi.received_quantity-poi.returned_quantity),0)>0)
         order by po.created_at desc limit $4 offset $5`,
        [
          request.authUser!.organization.id,
          branchId,
          search ?? null,
          pageSize,
          (page - 1) * pageSize,
          returnable,
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
  router.get('/returns', requirePermission('purchasing:read'), async (request, response) => {
    const branchId = uuidSchema.parse(request.query.branchId);
    assertBranchAccess(request, branchId);
    const result = await database.query(
      `select pr.id,pr.return_number as "returnNumber",pr.reason,pr.resolution,
        pr.total::text,pr.created_at as "createdAt",s.name as "supplierName",
        po.id as "purchaseOrderId",po.order_number as "orderNumber",
        coalesce((select sum(sr.amount) from supplier_refunds sr
          where sr.purchase_return_id=pr.id and sr.organization_id=pr.organization_id),0)::text
          as "refundedAmount",
        (pr.total-coalesce((select sum(sr.amount) from supplier_refunds sr
          where sr.purchase_return_id=pr.id and sr.organization_id=pr.organization_id),0))::text
          as "remainingRefund"
       from purchase_returns pr
       join suppliers s on s.id=pr.supplier_id
       join purchase_orders po on po.id=pr.purchase_order_id
       where pr.organization_id=$1 and pr.branch_id=$2
       order by pr.created_at desc limit 100`,
      [request.authUser!.organization.id, branchId],
    );
    sendData(response, result.rows);
  });
  router.get('/:id', requirePermission('purchasing:read'), async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;
    const order = await database.query(
      `select po.id,po.branch_id as "branchId",po.supplier_id as "supplierId",
        po.order_number as "orderNumber",po.status,po.expected_at as "expectedAt",
        po.supplier_reference as "supplierReference",po.notes,po.subtotal::text,
        po.ordered_at as "orderedAt",po.created_at as "createdAt",
        s.name as "supplierName",b.name as "branchName",p.display_name as "createdBy"
       from purchase_orders po
       join suppliers s on s.id=po.supplier_id
       join branches b on b.id=po.branch_id
       join profiles p on p.id=po.created_by
       where po.id=$1 and po.organization_id=$2`,
      [id, organizationId],
    );
    const header = order.rows[0] as any;
    if (!header) throw notFound('Purchase order');
    assertBranchAccess(request, header.branchId);
    const [items, receipts, returns, supplierInvoices] = await Promise.all([
      database.query(
        `select id,product_id as "productId",variant_id as "variantId",product_name as "productName",
          sku,purchase_unit as "purchaseUnit",units_per_base::float8 as "unitsPerBase",
          ordered_quantity::float8 as "orderedQuantity",
          received_quantity::float8 as "receivedQuantity",
          returned_quantity::float8 as "returnedQuantity",unit_cost::text as "unitCost",
          line_total::text as "lineTotal"
         from purchase_order_items where purchase_order_id=$1 and organization_id=$2
         order by created_at`,
        [id, organizationId],
      ),
      database.query(
        `select sr.id,sr.receipt_number as "receiptNumber",
          sr.supplier_invoice_number as "supplierInvoiceNumber",sr.received_at as "receivedAt",
          p.display_name as "receivedBy",
          coalesce(sum(sri.purchase_quantity),0)::float8 as quantity
         from stock_receipts sr join profiles p on p.id=sr.received_by
         left join stock_receipt_items sri on sri.stock_receipt_id=sr.id
         where sr.purchase_order_id=$1 and sr.organization_id=$2
         group by sr.id,p.id order by sr.received_at desc`,
        [id, organizationId],
      ),
      database.query(
        `select pr.id,pr.return_number as "returnNumber",pr.reason,pr.resolution,
          pr.total::text,pr.created_at as "createdAt",
          coalesce((select sum(sr.amount) from supplier_refunds sr
            where sr.purchase_return_id=pr.id and sr.organization_id=pr.organization_id),0)::text
            as "refundedAmount",
          (pr.total-coalesce((select sum(sr.amount) from supplier_refunds sr
            where sr.purchase_return_id=pr.id and sr.organization_id=pr.organization_id),0))::text
            as "remainingRefund",
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',sr.id,'refundNumber',sr.refund_number,'amount',sr.amount::text,
              'source',sr.source,'reference',sr.reference,'notes',sr.notes,
              'receivedAt',sr.received_at,'createdBy',rp.display_name
            ) order by sr.received_at desc)
            from supplier_refunds sr
            join profiles rp on rp.id=sr.created_by
            where sr.purchase_return_id=pr.id and sr.organization_id=pr.organization_id
          ),'[]'::jsonb) as refunds
         from purchase_returns pr
         where pr.purchase_order_id=$1 and pr.organization_id=$2 order by pr.created_at desc`,
        [id, organizationId],
      ),
      database.query(
        `select si.id,si.stock_receipt_id as "stockReceiptId",
          si.invoice_number as "invoiceNumber",si.invoice_date as "invoiceDate",
          si.due_date as "dueDate",si.total::text,si.paid_amount::text as "paidAmount",
          (si.total-si.paid_amount)::text as balance,
          case
            when si.status in ('disputed','credited','void') then si.status::text
            when si.paid_amount>=si.total then 'paid'
            when si.due_date<current_date then 'overdue'
            when si.paid_amount>0 then 'partially_paid'
            else 'unpaid'
          end as status,
          si.notes,si.created_at as "createdAt",p.display_name as "createdBy",
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',sp.id,'paymentNumber',sp.payment_number,'amount',sp.amount::text,
              'source',sp.source,'reference',sp.reference,'notes',sp.notes,
              'paidAt',sp.paid_at,'createdBy',pp.display_name,
              'refundedAmount',coalesce((select sum(sr.amount) from supplier_refunds sr
                where sr.supplier_payment_id=sp.id
                  and sr.organization_id=sp.organization_id),0)::text,
              'refundableAmount',(sp.amount-coalesce((select sum(sr.amount)
                from supplier_refunds sr where sr.supplier_payment_id=sp.id
                  and sr.organization_id=sp.organization_id),0))::text
            ) order by sp.paid_at desc)
            from supplier_payments sp
            join profiles pp on pp.id=sp.created_by
            where sp.supplier_invoice_id=si.id and sp.organization_id=si.organization_id
          ),'[]'::jsonb) as payments
         from supplier_invoices si
         join profiles p on p.id=si.created_by
         where si.purchase_order_id=$1 and si.organization_id=$2
         order by si.invoice_date desc,si.created_at desc`,
        [id, organizationId],
      ),
    ]);
    sendData(response, {
      ...header,
      items: items.rows,
      receipts: receipts.rows,
      returns: returns.rows,
      supplierInvoices: supplierInvoices.rows,
    });
  });
  router.post(
    '/',
    requirePermission('purchasing:manage'),
    requireBranchAccess('body'),
    validateBody(purchaseOrderSchema),
    async (request, response) => {
      const input = request.body;
      const organizationId = request.authUser!.organization.id;
      const order = await database.transaction(async (tx) => {
        const supplier = await tx.query(
          'select id from suppliers where id=$1 and organization_id=$2 and is_active',
          [input.supplierId, organizationId],
        );
        if (!supplier.rows[0]) throw badRequest('INVALID_SUPPLIER', 'Select an active supplier');
        const created = await tx.query<{ id: string; orderNumber: string }>(
          `insert into purchase_orders (
            organization_id,branch_id,supplier_id,order_number,expected_at,
            supplier_reference,notes,created_by
           ) values (
            $1,$2,$3,'PO-'||lpad(nextval('purchase_order_number_seq')::text,6,'0'),
            $4,$5,$6,$7
           ) returning id,order_number as "orderNumber"`,
          [
            organizationId,
            input.branchId,
            input.supplierId,
            input.expectedAt ?? null,
            input.supplierReference ?? null,
            input.notes ?? null,
            request.authUser!.id,
          ],
        );
        const seen = new Set<string>();
        for (const requested of input.items) {
          const key = `${requested.productId}:${requested.variantId ?? 'base'}`;
          if (seen.has(key)) {
            throw badRequest('DUPLICATE_PURCHASE_ITEM', 'Each product unit can appear only once');
          }
          seen.add(key);
          const product = await tx.query<{
            product_id: string;
            variant_id: string | null;
            product_name: string;
            sku: string;
            purchase_unit: string;
            units_per_base: number;
          }>(
            `select p.id as product_id,v.id as variant_id,p.name as product_name,
              coalesce(v.sku,p.sku) as sku,coalesce(v.unit,p.unit) as purchase_unit,
              coalesce(v.units_per_base,1)::float8 as units_per_base
             from products p
             left join product_variants v
               on v.product_id=p.id and v.organization_id=p.organization_id and v.id=$3
             where p.organization_id=$1 and p.id=$2
               and p.status in ('active','pending_receipt') and p.track_inventory
               and ($3::uuid is null or v.id is not null)`,
            [organizationId, requested.productId, requested.variantId ?? null],
          );
          if (!product.rows[0]) {
            throw badRequest(
              'INVALID_PURCHASE_PRODUCT',
              'Purchase items must be active, inventory-tracked products',
            );
          }
          const item = product.rows[0];
          await tx.query(
            `insert into purchase_order_items (
              organization_id,purchase_order_id,product_id,variant_id,product_name,sku,
              purchase_unit,units_per_base,ordered_quantity,unit_cost,line_total
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,round($9::numeric*$10::numeric,2))`,
            [
              organizationId,
              created.rows[0]!.id,
              item.product_id,
              item.variant_id,
              item.product_name,
              item.sku,
              item.purchase_unit,
              item.units_per_base,
              requested.quantity,
              requested.unitCost,
            ],
          );
        }
        const totals = await tx.query<{ subtotal: string }>(
          `update purchase_orders po set subtotal=(
            select sum(line_total) from purchase_order_items where purchase_order_id=po.id
           ) where po.id=$1 returning subtotal::text`,
          [created.rows[0]!.id],
        );
        await audit(tx, {
          organizationId,
          branchId: input.branchId,
          actorId: request.authUser!.id,
          action: 'purchase_order.created',
          entityType: 'purchase_order',
          entityId: created.rows[0]!.id,
          data: input,
        });
        return { ...created.rows[0]!, status: 'draft', subtotal: totals.rows[0]!.subtotal };
      });
      sendData(response, order, 201);
    },
  );
  router.post('/:id/send', requirePermission('purchasing:manage'), async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;
    const current = await database.query<PurchaseOrderRow>(
      'select id,branch_id,supplier_id,status from purchase_orders where id=$1 and organization_id=$2',
      [id, organizationId],
    );
    if (!current.rows[0]) throw notFound('Purchase order');
    assertBranchAccess(request, current.rows[0].branch_id);
    if (current.rows[0].status !== 'draft') {
      throw conflict('PURCHASE_ORDER_STATE', 'Only a draft purchase order can be sent');
    }
    const result = await database.query(
      `update purchase_orders set status='ordered',ordered_at=now(),updated_at=now()
       where id=$1 and organization_id=$2 returning id,status,ordered_at as "orderedAt"`,
      [id, organizationId],
    );
    await audit(database, {
      organizationId,
      branchId: current.rows[0].branch_id,
      actorId: request.authUser!.id,
      action: 'purchase_order.sent',
      entityType: 'purchase_order',
      entityId: id,
    });
    sendData(response, result.rows[0]);
  });
  router.post('/:id/cancel', requirePermission('purchasing:manage'), async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;
    const current = await database.query<PurchaseOrderRow>(
      'select id,branch_id,supplier_id,status from purchase_orders where id=$1 and organization_id=$2',
      [id, organizationId],
    );
    if (!current.rows[0]) throw notFound('Purchase order');
    assertBranchAccess(request, current.rows[0].branch_id);
    if (!['draft', 'ordered'].includes(current.rows[0].status)) {
      throw conflict(
        'PURCHASE_ORDER_STATE',
        'A received or already cancelled order cannot be cancelled',
      );
    }
    const received = await database.query(
      'select 1 from purchase_order_items where purchase_order_id=$1 and received_quantity>0 limit 1',
      [id],
    );
    if (received.rows[0]) {
      throw conflict('PURCHASE_ORDER_RECEIVED', 'An order with received stock cannot be cancelled');
    }
    const result = await database.query(
      `update purchase_orders set status='cancelled',cancelled_at=now(),updated_at=now()
       where id=$1 and organization_id=$2 returning id,status`,
      [id, organizationId],
    );
    await audit(database, {
      organizationId,
      branchId: current.rows[0].branch_id,
      actorId: request.authUser!.id,
      action: 'purchase_order.cancelled',
      entityType: 'purchase_order',
      entityId: id,
    });
    sendData(response, result.rows[0]);
  });
  router.post(
    '/:id/receipts',
    requirePermission('purchasing:receive'),
    validateBody(receivePurchaseOrderSchema),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const input = request.body;
      const receipt = await database.transaction(async (tx) => {
        const order = await tx.query<PurchaseOrderRow>(
          `select id,branch_id,supplier_id,status from purchase_orders
           where id=$1 and organization_id=$2 for update`,
          [id, organizationId],
        );
        if (!order.rows[0]) throw notFound('Purchase order');
        assertBranchAccess(request, order.rows[0].branch_id);
        if (!['ordered', 'partially_received'].includes(order.rows[0].status)) {
          throw conflict('PURCHASE_ORDER_STATE', 'Send the order before receiving stock');
        }
        const created = await tx.query<{ id: string; receiptNumber: string }>(
          `insert into stock_receipts (
            organization_id,branch_id,purchase_order_id,receipt_number,
            supplier_invoice_number,notes,received_by,received_at
           ) values (
            $1,$2,$3,'GRN-'||lpad(nextval('stock_receipt_number_seq')::text,6,'0'),
            $4,$5,$6,coalesce($7::timestamptz,now())
           ) returning id,receipt_number as "receiptNumber"`,
          [
            organizationId,
            order.rows[0].branch_id,
            id,
            input.supplierInvoiceNumber ?? null,
            input.notes ?? null,
            request.authUser!.id,
            input.receivedAt ?? null,
          ],
        );
        const seen = new Set<string>();
        for (const requested of input.items) {
          if (seen.has(requested.purchaseOrderItemId)) {
            throw badRequest('DUPLICATE_RECEIPT_ITEM', 'Each order line can appear only once');
          }
          seen.add(requested.purchaseOrderItemId);
          const source = await tx.query<{
            id: string;
            product_id: string;
            units_per_base: number;
            ordered_quantity: number;
            received_quantity: number;
            unit_cost: string;
            product_name: string;
            variant_id: string | null;
            portioning_variant_id: string | null;
          }>(
            `select id,product_id,units_per_base::float8,ordered_quantity::float8,
              received_quantity::float8,unit_cost::text,product_name,poi.variant_id,
              portioning.id as portioning_variant_id
             from purchase_order_items poi
             left join product_variants portioning
               on portioning.organization_id=poi.organization_id
               and portioning.product_id=poi.product_id and portioning.is_portioning_container
             where poi.id=$1 and poi.purchase_order_id=$2 and poi.organization_id=$3
             for update of poi`,
            [requested.purchaseOrderItemId, id, organizationId],
          );
          const item = source.rows[0];
          if (!item) throw badRequest('INVALID_RECEIPT_ITEM', 'Order line was not found');
          if (
            exceedsAvailable(
              requested.quantity,
              remainingToReceive(item.ordered_quantity, item.received_quantity),
            )
          ) {
            throw conflict(
              'RECEIPT_QUANTITY_EXCEEDED',
              `${item.product_name} exceeds the quantity still expected`,
            );
          }
          const baseQuantity = purchaseQuantityToBase(requested.quantity, item.units_per_base);
          const sealedReceipt = item.variant_id === item.portioning_variant_id;
          const sealedQuantity = sealedReceipt ? requested.quantity : 0;
          const openedQuantity = item.portioning_variant_id && !sealedReceipt ? baseQuantity : 0;
          const inventory = await tx.query<{
            quantity: number;
            averageCost: string;
            inventoryValue: string;
            sealedQuantity: number;
            openedQuantity: number;
          }>(
            `update branch_inventory set
               quantity=quantity+$4,
               inventory_value=case
                 when quantity+$4=0 then 0
                 when quantity<0 and quantity+$4>0
                   then round(
                     (quantity+$4)*($5::numeric*$6::numeric/$4::numeric),
                     4
                   )
                 when quantity+$4<0 then round(average_cost*(quantity+$4),4)
                 else round(inventory_value+$5::numeric*$6::numeric,4)
               end,
               average_cost=case
                 when quantity+$4=0 then average_cost
                 when quantity<0 and quantity+$4>0
                   then round($5::numeric*$6::numeric/$4::numeric,4)
                 when quantity+$4<0 then average_cost
                 else round(
                   (inventory_value+$5::numeric*$6::numeric)/(quantity+$4),
                   4
                 )
               end,
               sealed_quantity=sealed_quantity+$7,
               opened_quantity=opened_quantity+$8,
               updated_at=now()
             where organization_id=$1 and branch_id=$2 and product_id=$3
               and variant_id is null
             returning quantity::float8,average_cost::text as "averageCost",
               inventory_value::text as "inventoryValue",
               sealed_quantity::float8 as "sealedQuantity",
               opened_quantity::float8 as "openedQuantity"`,
            [
              organizationId,
              order.rows[0].branch_id,
              item.product_id,
              baseQuantity,
              requested.quantity,
              item.unit_cost,
              sealedQuantity,
              openedQuantity,
            ],
          );
          if (!inventory.rows[0]) throw notFound('Branch inventory');
          await tx.query(
            `update products set status='active',updated_at=now()
             where id=$1 and organization_id=$2 and status='pending_receipt'`,
            [item.product_id, organizationId],
          );
          await tx.query(
            'update purchase_order_items set received_quantity=received_quantity+$2 where id=$1',
            [item.id, requested.quantity],
          );
          await tx.query(
            `insert into stock_receipt_items (
              organization_id,stock_receipt_id,purchase_order_item_id,purchase_quantity,
              base_quantity,unit_cost
             ) values ($1,$2,$3,$4,$5,$6)`,
            [
              organizationId,
              created.rows[0]!.id,
              item.id,
              requested.quantity,
              baseQuantity,
              item.unit_cost,
            ],
          );
          await tx.query(
            `insert into inventory_movements (
              organization_id,branch_id,product_id,variant_id,movement_type,quantity_delta,
              quantity_after,reason,reference_type,reference_id,created_by
             ) values ($1,$2,$3,null,'purchase_receipt',$4,$5,$6,'stock_receipt',$7,$8)`,
            [
              organizationId,
              order.rows[0].branch_id,
              item.product_id,
              baseQuantity,
              inventory.rows[0].quantity,
              `Received ${created.rows[0]!.receiptNumber}`,
              created.rows[0]!.id,
              request.authUser!.id,
            ],
          );
          if (item.portioning_variant_id) {
            await tx.query(
              `insert into inventory_pool_movements (
                organization_id,branch_id,product_id,container_variant_id,movement_type,
                sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
                opened_quantity_after,reason,reference_type,reference_id,created_by
               ) values ($1,$2,$3,$4,'purchase_receipt',$5,$6,$7,$8,$9,
                 'stock_receipt',$10,$11)`,
              [
                organizationId,
                order.rows[0].branch_id,
                item.product_id,
                item.portioning_variant_id,
                sealedQuantity,
                openedQuantity,
                inventory.rows[0].sealedQuantity,
                inventory.rows[0].openedQuantity,
                `Received ${created.rows[0]!.receiptNumber}`,
                created.rows[0]!.id,
                request.authUser!.id,
              ],
            );
          }
        }
        const remaining = await tx.query<{ pending: boolean }>(
          `select exists(
            select 1 from purchase_order_items
            where purchase_order_id=$1 and received_quantity < ordered_quantity
           ) as pending`,
          [id],
        );
        const status = remaining.rows[0]!.pending ? 'partially_received' : 'received';
        await tx.query('update purchase_orders set status=$2,updated_at=now() where id=$1', [
          id,
          status,
        ]);
        await audit(tx, {
          organizationId,
          branchId: order.rows[0].branch_id,
          actorId: request.authUser!.id,
          action: 'purchase.received',
          entityType: 'stock_receipt',
          entityId: created.rows[0]!.id,
          data: input,
        });
        return { ...created.rows[0]!, orderStatus: status };
      });
      sendData(response, receipt, 201);
    },
  );
  router.post(
    '/:id/returns',
    requirePermission('purchasing:return'),
    validateBody(purchaseReturnSchema),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const input = request.body;
      const purchaseReturn = await database.transaction(async (tx) => {
        const order = await tx.query<PurchaseOrderRow>(
          `select id,branch_id,supplier_id,status from purchase_orders
           where id=$1 and organization_id=$2 for update`,
          [id, organizationId],
        );
        if (!order.rows[0]) throw notFound('Purchase order');
        assertBranchAccess(request, order.rows[0].branch_id);
        if (!['partially_received', 'received'].includes(order.rows[0].status)) {
          throw conflict('PURCHASE_ORDER_STATE', 'There is no received stock to return');
        }
        const seen = new Set<string>();
        const plannedItems: Array<{
          requested: { purchaseOrderItemId: string; quantity: number };
          item: {
            id: string;
            product_id: string;
            units_per_base: number;
            received_quantity: number;
            returned_quantity: number;
            unit_cost: string;
            product_name: string;
            variant_id: string | null;
            portioning_variant_id: string | null;
          };
          baseQuantity: number;
          refundAmount: string;
        }> = [];
        for (const requested of input.items) {
          if (seen.has(requested.purchaseOrderItemId)) {
            throw badRequest('DUPLICATE_RETURN_ITEM', 'Each order line can appear only once');
          }
          seen.add(requested.purchaseOrderItemId);
          const source = await tx.query<{
            id: string;
            product_id: string;
            units_per_base: number;
            received_quantity: number;
            returned_quantity: number;
            unit_cost: string;
            product_name: string;
            variant_id: string | null;
            portioning_variant_id: string | null;
          }>(
            `select id,product_id,units_per_base::float8,received_quantity::float8,
              returned_quantity::float8,unit_cost::text,product_name,poi.variant_id,
              portioning.id as portioning_variant_id
             from purchase_order_items poi
             left join product_variants portioning
               on portioning.organization_id=poi.organization_id
               and portioning.product_id=poi.product_id and portioning.is_portioning_container
             where poi.id=$1 and poi.purchase_order_id=$2 and poi.organization_id=$3
             for update of poi`,
            [requested.purchaseOrderItemId, id, organizationId],
          );
          const item = source.rows[0];
          if (!item) throw badRequest('INVALID_PURCHASE_RETURN_ITEM', 'Order line was not found');
          if (
            exceedsAvailable(
              requested.quantity,
              remainingToReturn(item.received_quantity, item.returned_quantity),
            )
          ) {
            throw conflict(
              'RETURN_QUANTITY_EXCEEDED',
              `${item.product_name} exceeds the received quantity available to return`,
            );
          }
          const baseQuantity = purchaseQuantityToBase(requested.quantity, item.units_per_base);
          plannedItems.push({
            requested,
            item,
            baseQuantity,
            refundAmount: purchaseLineAmount(requested.quantity, item.unit_cost),
          });
        }
        const total = purchaseReturnTotal(
          plannedItems.map(({ requested, item }) => ({
            quantity: requested.quantity,
            unitCost: item.unit_cost,
          })),
        );
        const created = await tx.query<{ id: string; returnNumber: string }>(
          `insert into purchase_returns (
            organization_id,branch_id,supplier_id,purchase_order_id,return_number,
            reason,resolution,supplier_reference,notes,total,created_by
           ) values (
            $1,$2,$3,$4,'PR-'||lpad(nextval('purchase_return_number_seq')::text,6,'0'),
            $5,$6,$7,$8,$9,$10
           ) returning id,return_number as "returnNumber"`,
          [
            organizationId,
            order.rows[0].branch_id,
            order.rows[0].supplier_id,
            id,
            input.reason,
            input.resolution,
            input.supplierReference ?? null,
            input.notes ?? null,
            total,
            request.authUser!.id,
          ],
        );
        for (const { requested, item, baseQuantity, refundAmount } of plannedItems) {
          const sealedReturn = item.variant_id === item.portioning_variant_id;
          const sealedQuantity = sealedReturn ? requested.quantity : 0;
          const openedQuantity = item.portioning_variant_id && !sealedReturn ? baseQuantity : 0;
          const inventory = await tx.query<{
            quantity: number;
            sealedQuantity: number;
            openedQuantity: number;
          }>(
            `update branch_inventory set
               quantity=quantity-$4,
               inventory_value=round(average_cost*(quantity-$4),4),
               sealed_quantity=sealed_quantity-$5,
               opened_quantity=opened_quantity-$6,
               updated_at=now()
             where organization_id=$1 and branch_id=$2 and product_id=$3
               and variant_id is null and quantity >= $4
               and sealed_quantity >= $5 and opened_quantity >= $6
             returning quantity::float8,
               sealed_quantity::float8 as "sealedQuantity",
               opened_quantity::float8 as "openedQuantity"`,
            [
              organizationId,
              order.rows[0].branch_id,
              item.product_id,
              baseQuantity,
              sealedQuantity,
              openedQuantity,
            ],
          );
          if (!inventory.rows[0]) {
            throw conflict(
              'INSUFFICIENT_RETURN_STOCK',
              `${item.product_name} does not have enough branch stock to return`,
            );
          }
          await tx.query(
            'update purchase_order_items set returned_quantity=returned_quantity+$2 where id=$1',
            [item.id, requested.quantity],
          );
          await tx.query(
            `insert into purchase_return_items (
              organization_id,purchase_return_id,purchase_order_item_id,purchase_quantity,
              base_quantity,refund_amount
             ) values ($1,$2,$3,$4,$5,$6)`,
            [
              organizationId,
              created.rows[0]!.id,
              item.id,
              requested.quantity,
              baseQuantity,
              refundAmount,
            ],
          );
          await tx.query(
            `insert into inventory_movements (
              organization_id,branch_id,product_id,variant_id,movement_type,quantity_delta,
              quantity_after,reason,reference_type,reference_id,created_by
             ) values ($1,$2,$3,null,'purchase_return',$4,$5,$6,'purchase_return',$7,$8)`,
            [
              organizationId,
              order.rows[0].branch_id,
              item.product_id,
              -baseQuantity,
              inventory.rows[0].quantity,
              input.reason,
              created.rows[0]!.id,
              request.authUser!.id,
            ],
          );
          if (item.portioning_variant_id) {
            await tx.query(
              `insert into inventory_pool_movements (
                organization_id,branch_id,product_id,container_variant_id,movement_type,
                sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
                opened_quantity_after,reason,reference_type,reference_id,created_by
               ) values ($1,$2,$3,$4,'purchase_return',$5,$6,$7,$8,$9,
                 'purchase_return',$10,$11)`,
              [
                organizationId,
                order.rows[0].branch_id,
                item.product_id,
                item.portioning_variant_id,
                -sealedQuantity,
                -openedQuantity,
                inventory.rows[0].sealedQuantity,
                inventory.rows[0].openedQuantity,
                input.reason,
                created.rows[0]!.id,
                request.authUser!.id,
              ],
            );
          }
        }
        await audit(tx, {
          organizationId,
          branchId: order.rows[0].branch_id,
          actorId: request.authUser!.id,
          action: 'purchase.returned',
          entityType: 'purchase_return',
          entityId: created.rows[0]!.id,
          data: input,
        });
        return { ...created.rows[0]!, total };
      });
      sendData(response, purchaseReturn, 201);
    },
  );
  router.post(
    '/:id/invoices',
    requirePermission('purchasing:pay'),
    validateBody(supplierInvoiceSchema),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const input = request.body;
      const invoice = await database.transaction(async (tx) => {
        const order = await tx.query<PurchaseOrderRow>(
          `select id,branch_id,supplier_id,status from purchase_orders
           where id=$1 and organization_id=$2 for update`,
          [id, organizationId],
        );
        if (!order.rows[0]) throw notFound('Purchase order');
        assertBranchAccess(request, order.rows[0].branch_id);
        if (!['partially_received', 'received'].includes(order.rows[0].status)) {
          throw conflict(
            'PURCHASE_ORDER_NOT_RECEIVED',
            'Record a supplier invoice only after stock has been received',
          );
        }
        if (input.stockReceiptId) {
          const receipt = await tx.query(
            `select 1 from stock_receipts
             where id=$1 and purchase_order_id=$2 and organization_id=$3`,
            [input.stockReceiptId, id, organizationId],
          );
          if (!receipt.rows[0]) {
            throw badRequest('INVALID_STOCK_RECEIPT', 'Select a receipt from this purchase order');
          }
        }
        const duplicate = await tx.query(
          `select 1 from supplier_invoices
           where organization_id=$1 and supplier_id=$2 and invoice_number=$3`,
          [organizationId, order.rows[0].supplier_id, input.invoiceNumber],
        );
        if (duplicate.rows[0]) {
          throw conflict(
            'SUPPLIER_INVOICE_EXISTS',
            'This supplier invoice number has already been recorded',
          );
        }
        const created = await tx.query(
          `insert into supplier_invoices (
            organization_id,branch_id,supplier_id,purchase_order_id,stock_receipt_id,
            invoice_number,invoice_date,due_date,total,notes,created_by
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           returning id,invoice_number as "invoiceNumber",invoice_date as "invoiceDate",
             due_date as "dueDate",total::text,paid_amount::text as "paidAmount",
             (total-paid_amount)::text as balance,status,notes,created_at as "createdAt"`,
          [
            organizationId,
            order.rows[0].branch_id,
            order.rows[0].supplier_id,
            id,
            input.stockReceiptId ?? null,
            input.invoiceNumber,
            input.invoiceDate,
            input.dueDate ?? null,
            input.total,
            input.notes ?? null,
            request.authUser!.id,
          ],
        );
        await audit(tx, {
          organizationId,
          branchId: order.rows[0].branch_id,
          actorId: request.authUser!.id,
          action: 'supplier_invoice.created',
          entityType: 'supplier_invoice',
          entityId: created.rows[0]!.id,
          data: input,
        });
        return { ...created.rows[0]!, payments: [] };
      });
      sendData(response, invoice, 201);
    },
  );
  router.post(
    '/invoices/:invoiceId/payments',
    requirePermission('purchasing:pay'),
    validateBody(supplierPaymentSchema),
    async (request, response) => {
      const invoiceId = uuidSchema.parse(request.params.invoiceId);
      const organizationId = request.authUser!.organization.id;
      const input = request.body;
      const idempotencyKey = request.header('idempotency-key')?.trim();
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
        throw badRequest(
          'IDEMPOTENCY_KEY_REQUIRED',
          'A valid idempotency key is required for supplier payments',
        );
      }
      const result = await database.transaction(async (tx) => {
        const existing = await tx.query(
          `select sp.id,sp.payment_number as "paymentNumber",sp.amount::text,sp.source,
            sp.reference,sp.paid_at as "paidAt",si.status,
            (si.total-si.paid_amount)::text as balance
           from supplier_payments sp
           join supplier_invoices si on si.id=sp.supplier_invoice_id
           where sp.organization_id=$1 and sp.idempotency_key=$2`,
          [organizationId, idempotencyKey],
        );
        if (existing.rows[0]) return existing.rows[0];

        const invoice = await tx.query<{
          id: string;
          branch_id: string;
          supplier_id: string;
          invoice_number: string;
          total: string;
          paid_amount: string;
          status: string;
        }>(
          `select id,branch_id,supplier_id,invoice_number,total::text,paid_amount::text,status
           from supplier_invoices where id=$1 and organization_id=$2 for update`,
          [invoiceId, organizationId],
        );
        const payable = invoice.rows[0];
        if (!payable) throw notFound('Supplier invoice');
        assertBranchAccess(request, payable.branch_id);
        if (['paid', 'credited', 'void'].includes(payable.status)) {
          throw conflict('SUPPLIER_INVOICE_CLOSED', 'This supplier invoice is already closed');
        }
        if (payable.status === 'disputed') {
          throw conflict(
            'SUPPLIER_INVOICE_DISPUTED',
            'Resolve the invoice dispute before recording payment',
          );
        }
        const paymentMinor = moneyToMinor(input.amount);
        const balanceMinor = moneyToMinor(payable.total) - moneyToMinor(payable.paid_amount);
        if (paymentMinor > balanceMinor) {
          throw conflict(
            'SUPPLIER_PAYMENT_EXCEEDS_BALANCE',
            `Payment cannot exceed the remaining balance of ${minorToMoney(balanceMinor)}`,
          );
        }

        if (input.source === 'cashier_drawer') {
          const shift = await tx.query<{ available_cash: string }>(
            `select greatest((
              rs.starting_cash+rs.cash_sales-rs.cash_refunds+
              coalesce((select sum(cm.amount) from cash_movements cm
                where cm.shift_id=rs.id and cm.type='cash_in'),0)-
              coalesce((select sum(cm.amount) from cash_movements cm
                where cm.shift_id=rs.id and cm.type='cash_out'),0)
             ),0)::text as available_cash
             from register_shifts rs
             where rs.id=$1 and rs.register_id=$2 and rs.organization_id=$3
               and rs.branch_id=$4 and rs.cashier_id=$5 and rs.status='open'
             for update of rs`,
            [
              input.shiftId,
              input.registerId,
              organizationId,
              payable.branch_id,
              request.authUser!.id,
            ],
          );
          if (!shift.rows[0]) {
            throw forbidden(
              'SHIFT_ACCESS_DENIED',
              'The selected cashier drawer does not have your matching open shift',
            );
          }
          if (moneyToMinor(shift.rows[0].available_cash) < paymentMinor) {
            throw conflict(
              'INSUFFICIENT_DRAWER_CASH',
              'The cashier drawer does not contain enough expected cash for this payment',
            );
          }
        }

        const payment = await tx.query<{
          id: string;
          paymentNumber: string;
          amount: string;
          source: string;
          reference?: string;
          paidAt: string;
        }>(
          `insert into supplier_payments (
            organization_id,branch_id,supplier_invoice_id,payment_number,idempotency_key,
            amount,source,register_id,shift_id,reference,notes,created_by
           ) values (
            $1,$2,$3,'SP-'||lpad(nextval('supplier_payment_number_seq')::text,6,'0'),
            $4,$5,$6,$7,$8,$9,$10,$11
           ) returning id,payment_number as "paymentNumber",amount::text,source,
             reference,paid_at as "paidAt"`,
          [
            organizationId,
            payable.branch_id,
            payable.id,
            idempotencyKey,
            input.amount,
            input.source,
            input.source === 'cashier_drawer' ? input.registerId : null,
            input.source === 'cashier_drawer' ? input.shiftId : null,
            input.reference ?? null,
            input.notes ?? null,
            request.authUser!.id,
          ],
        );
        if (input.source === 'cashier_drawer') {
          await tx.query(
            `insert into cash_movements (
              organization_id,branch_id,shift_id,type,amount,reason,created_by,
              supplier_payment_id
             ) values ($1,$2,$3,'cash_out',$4,$5,$6,$7)`,
            [
              organizationId,
              payable.branch_id,
              input.shiftId,
              input.amount,
              `Supplier invoice ${payable.invoice_number}`,
              request.authUser!.id,
              payment.rows[0]!.id,
            ],
          );
        }
        const newPaidMinor = moneyToMinor(payable.paid_amount) + paymentMinor;
        const newStatus = newPaidMinor === moneyToMinor(payable.total) ? 'paid' : 'partially_paid';
        await tx.query(
          `update supplier_invoices set paid_amount=$2,status=$3,updated_at=now()
           where id=$1`,
          [payable.id, minorToMoney(newPaidMinor), newStatus],
        );
        await audit(tx, {
          organizationId,
          branchId: payable.branch_id,
          actorId: request.authUser!.id,
          action: 'supplier_payment.created',
          entityType: 'supplier_payment',
          entityId: payment.rows[0]!.id,
          data: { ...input, supplierInvoiceId: payable.id },
        });
        return {
          ...payment.rows[0]!,
          status: newStatus,
          balance: minorToMoney(moneyToMinor(payable.total) - newPaidMinor),
        };
      });
      sendData(response, result, 201);
    },
  );
  router.post(
    '/returns/:returnId/refunds',
    requirePermission('purchasing:pay'),
    validateBody(supplierRefundSchema),
    async (request, response) => {
      const returnId = uuidSchema.parse(request.params.returnId);
      const organizationId = request.authUser!.organization.id;
      const input = request.body;
      const idempotencyKey = request.header('idempotency-key')?.trim();
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
        throw badRequest(
          'IDEMPOTENCY_KEY_REQUIRED',
          'A valid idempotency key is required for supplier refunds',
        );
      }
      const result = await database.transaction(async (tx) => {
        const existing = await tx.query(
          `select sr.id,sr.refund_number as "refundNumber",sr.amount::text,sr.source,
            sr.reference,sr.received_at as "receivedAt",
            (pr.total-coalesce((select sum(all_refunds.amount) from supplier_refunds all_refunds
              where all_refunds.purchase_return_id=pr.id),0))::text as "remainingRefund"
           from supplier_refunds sr
           join purchase_returns pr on pr.id=sr.purchase_return_id
           where sr.organization_id=$1 and sr.idempotency_key=$2`,
          [organizationId, idempotencyKey],
        );
        if (existing.rows[0]) return existing.rows[0];

        const source = await tx.query<{
          return_id: string;
          branch_id: string;
          return_number: string;
          resolution: string;
          return_total: string;
          payment_id: string;
          payment_number: string;
          payment_amount: string;
          payment_source: string;
        }>(
          `select pr.id as return_id,pr.branch_id,pr.return_number,
            pr.resolution,pr.total::text as return_total,
            sp.id as payment_id,sp.payment_number,sp.amount::text as payment_amount,
            sp.source::text as payment_source
           from purchase_returns pr
           join supplier_payments sp
             on sp.id=$2 and sp.organization_id=pr.organization_id
           join supplier_invoices si
             on si.id=sp.supplier_invoice_id
            and si.purchase_order_id=pr.purchase_order_id
            and si.organization_id=pr.organization_id
           where pr.id=$1 and pr.organization_id=$3
           for update of pr,sp`,
          [returnId, input.supplierPaymentId, organizationId],
        );
        const original = source.rows[0];
        if (!original) {
          throw badRequest(
            'INVALID_SUPPLIER_PAYMENT',
            'Select a supplier payment from this purchase order',
          );
        }
        assertBranchAccess(request, original.branch_id);
        if (original.resolution !== 'refund') {
          throw conflict(
            'PURCHASE_RETURN_NOT_REFUND',
            'This return expects supplier credit or replacement, not a monetary refund',
          );
        }

        const [returnRefunds, paymentRefunds] = await Promise.all([
          tx.query<{ total: string }>(
            `select coalesce(sum(amount),0)::text as total from supplier_refunds
             where purchase_return_id=$1 and organization_id=$2`,
            [returnId, organizationId],
          ),
          tx.query<{ total: string }>(
            `select coalesce(sum(amount),0)::text as total from supplier_refunds
             where supplier_payment_id=$1 and organization_id=$2`,
            [original.payment_id, organizationId],
          ),
        ]);
        const refundMinor = moneyToMinor(input.amount);
        const returnRemainingMinor =
          moneyToMinor(original.return_total) - moneyToMinor(returnRefunds.rows[0]!.total);
        const paymentRemainingMinor =
          moneyToMinor(original.payment_amount) - moneyToMinor(paymentRefunds.rows[0]!.total);
        if (refundMinor > returnRemainingMinor) {
          throw conflict(
            'SUPPLIER_REFUND_EXCEEDS_RETURN',
            `Refund cannot exceed the returned-goods balance of ${minorToMoney(returnRemainingMinor)}`,
          );
        }
        if (refundMinor > paymentRemainingMinor) {
          throw conflict(
            'SUPPLIER_REFUND_EXCEEDS_PAYMENT',
            `Refund cannot exceed the refundable payment balance of ${minorToMoney(paymentRemainingMinor)}`,
          );
        }

        if (original.payment_source === 'cashier_drawer') {
          if (!input.registerId || !input.shiftId) {
            throw badRequest(
              'OPEN_SHIFT_REQUIRED',
              'Your open cashier shift is required to receive this cash refund',
            );
          }
          const shift = await tx.query(
            `select 1 from register_shifts
             where id=$1 and register_id=$2 and organization_id=$3 and branch_id=$4
               and cashier_id=$5 and status='open'
             for update`,
            [
              input.shiftId,
              input.registerId,
              organizationId,
              original.branch_id,
              request.authUser!.id,
            ],
          );
          if (!shift.rows[0]) {
            throw forbidden(
              'SHIFT_ACCESS_DENIED',
              'The selected cashier drawer does not have your matching open shift',
            );
          }
        } else if (input.registerId || input.shiftId) {
          throw badRequest(
            'REGISTER_NOT_ALLOWED',
            'Only a cashier-drawer refund may be added to an open shift',
          );
        }

        const refund = await tx.query<{
          id: string;
          refundNumber: string;
          amount: string;
          source: string;
          reference?: string;
          receivedAt: string;
        }>(
          `insert into supplier_refunds (
            organization_id,branch_id,purchase_return_id,supplier_payment_id,
            refund_number,idempotency_key,amount,source,register_id,shift_id,
            reference,notes,created_by
           ) values (
            $1,$2,$3,$4,'SRF-'||lpad(nextval('supplier_refund_number_seq')::text,6,'0'),
            $5,$6,$7,$8,$9,$10,$11,$12
           ) returning id,refund_number as "refundNumber",amount::text,source,
             reference,received_at as "receivedAt"`,
          [
            organizationId,
            original.branch_id,
            returnId,
            original.payment_id,
            idempotencyKey,
            input.amount,
            original.payment_source,
            original.payment_source === 'cashier_drawer' ? input.registerId : null,
            original.payment_source === 'cashier_drawer' ? input.shiftId : null,
            input.reference ?? null,
            input.notes ?? null,
            request.authUser!.id,
          ],
        );
        if (original.payment_source === 'cashier_drawer') {
          await tx.query(
            `insert into cash_movements (
              organization_id,branch_id,shift_id,type,amount,reason,created_by,
              supplier_refund_id
             ) values ($1,$2,$3,'cash_in',$4,$5,$6,$7)`,
            [
              organizationId,
              original.branch_id,
              input.shiftId,
              input.amount,
              `Supplier refund ${original.return_number}`,
              request.authUser!.id,
              refund.rows[0]!.id,
            ],
          );
        }
        await audit(tx, {
          organizationId,
          branchId: original.branch_id,
          actorId: request.authUser!.id,
          action: 'supplier_refund.created',
          entityType: 'supplier_refund',
          entityId: refund.rows[0]!.id,
          data: {
            ...input,
            purchaseReturnId: returnId,
            source: original.payment_source,
            supplierPaymentNumber: original.payment_number,
          },
        });
        return {
          ...refund.rows[0]!,
          remainingRefund: minorToMoney(returnRemainingMinor - refundMinor),
        };
      });
      sendData(response, result, 201);
    },
  );
  return router;
}
