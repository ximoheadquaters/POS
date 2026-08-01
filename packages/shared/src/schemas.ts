import { z } from 'zod';
import {
  EMPLOYEE_ROLE_CODES,
  MODULE_CODES,
  PAYMENT_METHODS,
  PERMISSIONS,
  ROLE_CODES,
} from './constants.js';
import { moneyStringSchema } from './money.js';

export const uuidSchema = z.uuid();
export const dateTimeSchema = z.iso.datetime({ offset: true });
const optionalBarcodeSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(3).max(80).optional(),
);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
  search: z.string().trim().max(120).optional(),
});

export const productLookupSchema = z.object({
  code: z.string().trim().min(3).max(80),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
});

export const createEmployeeSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  temporaryPassword: z.string().min(12).max(200),
  pin: z.string().trim().min(4).max(8).optional(),
  role: z.enum(EMPLOYEE_ROLE_CODES),
  branchIds: z
    .array(uuidSchema)
    .min(1)
    .max(100)
    .refine((values) => new Set(values).size === values.length, 'Select each branch only once'),
});

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[A-Z0-9_-]+$/),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(40).optional(),
  isActive: z.boolean().default(true),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
});

export const brandSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
});

export const productUnitCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(24)
  .regex(/^[a-z][a-z0-9_-]*$/);

export const productUnitSchema = z.object({
  code: productUnitCodeSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['discrete', 'decimal']).default('discrete'),
  defaultStep: z.number().positive().max(1_000_000).multipleOf(0.001).default(1),
  isActive: z.boolean().default(true),
});

export const productSchema = z.object({
  categoryId: uuidSchema.nullable().optional(),
  brandId: uuidSchema.nullable().optional(),
  name: z.string().trim().min(1).max(180),
  sku: z.string().trim().min(1).max(80),
  barcode: optionalBarcodeSchema,
  unit: productUnitCodeSchema.default('piece'),
  trackInventory: z.boolean().default(true),
  description: z.string().trim().max(2000).optional(),
  cost: moneyStringSchema,
  sellingPrice: moneyStringSchema,
  taxRate: z
    .string()
    .regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/)
    .default('0.00'),
  isTaxInclusive: z.boolean().default(false),
  status: z.enum(['active', 'inactive', 'pending_receipt']).default('active'),
  imagePath: z.string().trim().max(500).optional(),
});

export const recipeItemSchema = z.object({
  ingredientProductId: uuidSchema,
  ingredientVariantId: uuidSchema.nullable().optional(),
  quantityRequired: z.number().positive().max(1_000_000),
  unit: productUnitCodeSchema.default('piece'),
});

export const saveRecipeSchema = z.object({
  items: z.array(recipeItemSchema),
  costOverride: moneyStringSchema.optional(),
});

export const updateProductSchema = z.object({
  categoryId: uuidSchema.nullable().optional(),
  brandId: uuidSchema.nullable().optional(),
  name: z.string().trim().min(1).max(180).optional(),
  sku: z.string().trim().min(1).max(80).optional(),
  // Null explicitly removes an existing barcode. Undefined leaves it unchanged.
  barcode: optionalBarcodeSchema.nullable().optional(),
  unit: productUnitCodeSchema.optional(),
  trackInventory: z.boolean().optional(),
  description: z.string().trim().max(2000).optional(),
  cost: moneyStringSchema.optional(),
  sellingPrice: moneyStringSchema.optional(),
  taxRate: z
    .string()
    .regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/)
    .optional(),
  isTaxInclusive: z.boolean().optional(),
  status: z.enum(['active', 'inactive', 'pending_receipt']).optional(),
  imagePath: z.string().trim().max(500).optional(),
});

export const createProductSchema = productSchema.extend({
  branchId: uuidSchema,
  openingQuantity: z.number().min(0).max(1_000_000).multipleOf(0.001).default(0),
  sellingUnits: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        sku: z.string().trim().min(1).max(80),
        barcode: optionalBarcodeSchema,
        unit: productUnitCodeSchema,
        unitsPerBase: z.number().positive().max(1_000_000).multipleOf(0.001),
        cost: moneyStringSchema.optional(),
        sellingPrice: moneyStringSchema,
      }),
    )
    .max(20)
    .default([]),
});

export const productVariantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(80),
  barcode: optionalBarcodeSchema,
  unit: productUnitCodeSchema.default('piece'),
  unitsPerBase: z.number().positive().max(1_000_000).multipleOf(0.001).default(1),
  cost: moneyStringSchema.optional(),
  sellingPrice: moneyStringSchema.optional(),
  isActive: z.boolean().default(true),
});

export const stockAdjustmentSchema = z.object({
  branchId: uuidSchema,
  productId: uuidSchema,
  variantId: uuidSchema.nullable().optional(),
  quantityDelta: z
    .number()
    .min(-1_000_000)
    .max(1_000_000)
    .multipleOf(0.001)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(300),
});

const purchaseQuantitySchema = z.number().positive().max(1_000_000).multipleOf(0.001);

export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(180),
  contactName: z.string().trim().max(120).optional(),
  email: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.email().optional(),
  ),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  taxId: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
  isActive: z.boolean().default(true),
});

export const purchaseOrderItemSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullable().optional(),
  quantity: purchaseQuantitySchema,
  unitCost: moneyStringSchema,
});

export const purchaseOrderSchema = z.object({
  branchId: uuidSchema,
  supplierId: uuidSchema,
  expectedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  supplierReference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(purchaseOrderItemSchema).min(1).max(250),
});

export const receivePurchaseOrderSchema = z.object({
  receivedAt: z.iso.datetime({ offset: true }).optional(),
  supplierInvoiceNumber: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z
    .array(
      z.object({
        purchaseOrderItemId: uuidSchema,
        quantity: purchaseQuantitySchema,
      }),
    )
    .min(1)
    .max(250),
});

export const purchaseReturnSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  resolution: z.enum(['refund', 'replacement', 'supplier_credit']),
  supplierReference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z
    .array(
      z.object({
        purchaseOrderItemId: uuidSchema,
        quantity: purchaseQuantitySchema,
      }),
    )
    .min(1)
    .max(250),
});

export const supplierInvoiceSchema = z
  .object({
    stockReceiptId: uuidSchema.nullable().optional(),
    invoiceNumber: z.string().trim().min(1).max(120),
    invoiceDate: z.iso.date(),
    dueDate: z.iso.date().nullable().optional(),
    total: moneyStringSchema.refine((value) => Number(value) > 0, 'Invoice total must be positive'),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((input) => !input.dueDate || input.dueDate >= input.invoiceDate, {
    path: ['dueDate'],
    message: 'Due date cannot be before the invoice date',
  });

export const supplierPaymentSourceSchema = z.enum([
  'cashier_drawer',
  'owner_cash',
  'bank_transfer',
  'ewallet',
  'cheque',
]);

export const supplierPaymentSchema = z
  .object({
    amount: moneyStringSchema.refine((value) => Number(value) > 0, 'Payment must be positive'),
    source: supplierPaymentSourceSchema,
    registerId: uuidSchema.nullable().optional(),
    shiftId: uuidSchema.nullable().optional(),
    reference: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine(
    (input) =>
      input.source !== 'cashier_drawer' || (Boolean(input.registerId) && Boolean(input.shiftId)),
    {
      path: ['shiftId'],
      message: 'An open register shift is required when paying from the cashier drawer',
    },
  )
  .refine((input) => input.source === 'cashier_drawer' || (!input.registerId && !input.shiftId), {
    path: ['shiftId'],
    message: 'Register details are only allowed for cashier-drawer payments',
  });

export const supplierRefundSchema = z.object({
  supplierPaymentId: uuidSchema,
  amount: moneyStringSchema.refine((value) => Number(value) > 0, 'Refund must be positive'),
  registerId: uuidSchema.optional().nullable(),
  shiftId: uuidSchema.optional().nullable(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const openShiftSchema = z.object({
  registerId: uuidSchema,
  startingCash: moneyStringSchema,
});

export const cashMovementSchema = z.object({
  shiftId: uuidSchema,
  type: z.enum(['cash_in', 'cash_out']),
  amount: moneyStringSchema.refine((value) => value !== '0' && value !== '0.00'),
  reason: z.string().trim().min(3).max(300),
});

export const closeShiftSchema = z.object({
  actualCash: moneyStringSchema,
  notes: z.string().trim().max(500).optional(),
});

export const cartItemSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullable().optional(),
  quantity: z.number().positive().max(999_999).multipleOf(0.001),
});

export const discountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), value: moneyStringSchema }),
  z.object({
    type: z.literal('percentage'),
    value: z.string().regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/),
  }),
]);

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: moneyStringSchema,
  reference: z.string().trim().max(120).optional(),
  tendered: moneyStringSchema.optional(),
});

export const checkoutSchema = z.object({
  branchId: uuidSchema,
  registerId: uuidSchema,
  shiftId: uuidSchema,
  customerId: uuidSchema.nullable().optional(),
  items: z.array(cartItemSchema).min(1).max(250),
  discount: discountSchema.optional(),
  payments: z.array(paymentSchema).min(1).max(10),
  note: z.string().trim().max(500).optional(),
});

export const holdSaleSchema = z.object({
  branchId: uuidSchema,
  registerId: uuidSchema.nullable().optional(),
  shiftId: uuidSchema.nullable().optional(),
  customerId: uuidSchema.nullable().optional(),
  note: z.string().trim().max(500).optional(),
  items: z.array(cartItemSchema).min(1).max(250),
});

export const returnSchema = z.object({
  branchId: uuidSchema,
  registerId: uuidSchema,
  shiftId: uuidSchema,
  restock: z.boolean().default(true).optional(),
  items: z
    .array(
      z.object({
        saleItemId: uuidSchema,
        quantity: z.number().positive().max(999_999).multipleOf(0.001),
        restock: z.boolean().optional(),
      }),
    )
    .min(1),
  reason: z.string().trim().min(3).max(500),
  refundMethod: z.enum(PAYMENT_METHODS),
});

export const customerSchema = z.object({
  name: z.string().trim().min(1).max(180),
  email: z.email().optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const organizationSettingsSchema = z
  .object({
    businessName: z.string().trim().min(2).max(180),
    currency: z.string().length(3).toUpperCase(),
    timezone: z.string().min(3).max(80),
    taxRate: z.string().regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/),
    receiptHeader: z.string().max(500),
    receiptFooter: z.string().max(500),
    allowNegativeInventory: z.boolean(),
    paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1),
    targetMarginPercent: z.string().regex(/^(\d{1,2}(\.\d{1,2})?)$/),
    lowMarginThresholdPercent: z.string().regex(/^(\d{1,2}(\.\d{1,2})?)$/),
  })
  .refine(
    (settings) =>
      Number(settings.lowMarginThresholdPercent) <= Number(settings.targetMarginPercent),
    {
      path: ['lowMarginThresholdPercent'],
      message: 'Low-margin warning must not exceed the target margin',
    },
  );

export const organizationProfileSchema = z.object({
  name: z.string().trim().min(2).max(180),
  currency: z.string().trim().length(3).toUpperCase(),
  timezone: z.string().trim().min(3).max(80),
  logoPath: z.string().trim().max(500).nullable(),
});

export const roleCodeSchema = z.enum(ROLE_CODES);
export const permissionSchema = z.enum(PERMISSIONS);
export const moduleCodeSchema = z.enum(MODULE_CODES);

export const createStockTransferSchema = z
  .object({
    fromBranchId: uuidSchema,
    toBranchId: uuidSchema,
    notes: z.string().trim().max(1000).optional(),
    items: z
      .array(
        z.object({
          productId: uuidSchema,
          quantity: z.number().positive('Quantity must be greater than zero'),
        }),
      )
      .min(1, 'At least one item is required'),
  })
  .refine((val) => val.fromBranchId !== val.toBranchId, {
    path: ['toBranchId'],
    message: 'Destination branch must be different from source branch',
  });

export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>;

export const promotionTypeSchema = z.enum([
  'combo_bundle',
  'buy_x_get_y',
  'tiered_quantity',
  'percentage_discount',
  'fixed_discount',
]);

export const createPromotionSchema = z.object({
  name: z.string().trim().min(2).max(180),
  code: z.string().trim().max(50).optional(),
  description: z.string().trim().max(1000).optional(),
  type: promotionTypeSchema,
  comboPrice: moneyStringSchema.optional(),
  discountPercentage: z
    .string()
    .regex(/^(\d{1,2}(\.\d{1,2})?|100(\.0{1,2})?)$/)
    .optional(),
  discountAmount: moneyStringSchema.optional(),
  minOrderQuantity: z.number().int().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isActive: z.boolean().default(true),
  items: z
    .array(
      z.object({
        productId: uuidSchema,
        role: z
          .enum(['trigger_item', 'discounted_item', 'combo_component'])
          .default('combo_component'),
        requiredQuantity: z.number().int().min(1).default(1),
      }),
    )
    .optional(),
});

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type BranchInput = z.infer<typeof branchSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type BrandInput = z.infer<typeof brandSchema>;
export type ProductUnitInput = z.infer<typeof productUnitSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type ProductVariantInput = z.infer<typeof productVariantSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type SupplierInput = z.infer<typeof supplierSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
export type PurchaseReturnInput = z.infer<typeof purchaseReturnSchema>;
export type SupplierInvoiceInput = z.infer<typeof supplierInvoiceSchema>;
export type SupplierPaymentInput = z.infer<typeof supplierPaymentSchema>;
export type SupplierPaymentSource = z.infer<typeof supplierPaymentSourceSchema>;
export type SupplierRefundInput = z.infer<typeof supplierRefundSchema>;
export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CashMovementInput = z.infer<typeof cashMovementSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ReturnInput = z.infer<typeof returnSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type OrganizationSettingsInput = z.infer<typeof organizationSettingsSchema>;
export type OrganizationProfileInput = z.infer<typeof organizationProfileSchema>;
