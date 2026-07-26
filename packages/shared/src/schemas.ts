import { z } from 'zod';
import { MODULE_CODES, PAYMENT_METHODS, PERMISSIONS, ROLE_CODES } from './constants.js';
import { moneyStringSchema } from './money.js';

export const uuidSchema = z.uuid();
export const dateTimeSchema = z.iso.datetime({ offset: true });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
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

export const productSchema = z.object({
  categoryId: uuidSchema.nullable().optional(),
  name: z.string().trim().min(1).max(180),
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().min(3).max(80).optional(),
  description: z.string().trim().max(2000).optional(),
  cost: moneyStringSchema,
  sellingPrice: moneyStringSchema,
  taxRate: z
    .string()
    .regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/)
    .default('0.00'),
  isTaxInclusive: z.boolean().default(false),
  status: z.enum(['active', 'inactive']).default('active'),
  imagePath: z.string().trim().max(500).optional(),
});

export const productVariantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().min(3).max(80).optional(),
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
    .int()
    .refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(300),
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
  quantity: z.number().int().positive().max(9999),
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

export const returnSchema = z.object({
  branchId: uuidSchema,
  items: z
    .array(
      z.object({
        saleItemId: uuidSchema,
        quantity: z.number().int().positive(),
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

export const organizationSettingsSchema = z.object({
  businessName: z.string().trim().min(2).max(180),
  currency: z.string().length(3).toUpperCase(),
  timezone: z.string().min(3).max(80),
  taxRate: z.string().regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/),
  receiptHeader: z.string().max(500),
  receiptFooter: z.string().max(500),
  allowNegativeInventory: z.boolean(),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1),
});

export const roleCodeSchema = z.enum(ROLE_CODES);
export const permissionSchema = z.enum(PERMISSIONS);
export const moduleCodeSchema = z.enum(MODULE_CODES);

export type LoginInput = z.infer<typeof loginSchema>;
export type BranchInput = z.infer<typeof branchSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type ProductVariantInput = z.infer<typeof productVariantSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CashMovementInput = z.infer<typeof cashMovementSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ReturnInput = z.infer<typeof returnSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type OrganizationSettingsInput = z.infer<typeof organizationSettingsSchema>;
