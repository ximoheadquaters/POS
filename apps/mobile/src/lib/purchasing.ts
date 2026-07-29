export type PurchaseOrderStatus =
  | 'draft'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  notes?: string;
  isActive: boolean;
  orderCount?: number;
  orderedTotal?: string;
}

export interface PurchaseOrderSummary {
  id: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  subtotal: string;
  expectedAt?: string;
  createdAt: string;
  supplierId: string;
  supplierName: string;
  branchName: string;
  orderedQuantity: number;
  receivedQuantity: number;
  returnedQuantity: number;
  returnableQuantity: number;
  outstandingBalance: string;
  invoiceCount: number;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  variantId?: string;
  productName: string;
  sku: string;
  purchaseUnit: string;
  unitsPerBase: number;
  orderedQuantity: number;
  receivedQuantity: number;
  returnedQuantity: number;
  unitCost: string;
  lineTotal: string;
}

export interface PurchaseOrderDetail {
  id: string;
  branchId: string;
  supplierId: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  expectedAt?: string;
  supplierReference?: string;
  notes?: string;
  subtotal: string;
  orderedAt?: string;
  createdAt: string;
  supplierName: string;
  branchName: string;
  createdBy: string;
  items: PurchaseOrderItem[];
  receipts: Array<{
    id: string;
    receiptNumber: string;
    supplierInvoiceNumber?: string;
    receivedAt: string;
    receivedBy: string;
    quantity: number;
  }>;
  returns: Array<{
    id: string;
    returnNumber: string;
    reason: string;
    resolution: 'refund' | 'replacement' | 'supplier_credit';
    total: string;
    refundedAmount: string;
    remainingRefund: string;
    createdAt: string;
    refunds: Array<{
      id: string;
      refundNumber: string;
      amount: string;
      source: SupplierPaymentSource;
      reference?: string;
      notes?: string;
      receivedAt: string;
      createdBy: string;
    }>;
  }>;
  supplierInvoices: SupplierInvoice[];
}

export type SupplierInvoiceStatus =
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'disputed'
  | 'credited'
  | 'void';

export type SupplierPaymentSource =
  | 'cashier_drawer'
  | 'owner_cash'
  | 'bank_transfer'
  | 'ewallet'
  | 'cheque';

export interface SupplierInvoice {
  id: string;
  stockReceiptId?: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  total: string;
  paidAmount: string;
  balance: string;
  status: SupplierInvoiceStatus;
  notes?: string;
  createdAt: string;
  createdBy: string;
  payments: Array<{
    id: string;
    paymentNumber: string;
    amount: string;
    source: SupplierPaymentSource;
    refundedAmount: string;
    refundableAmount: string;
    reference?: string;
    notes?: string;
    paidAt: string;
    createdBy: string;
  }>;
}

export const PURCHASE_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  ordered: 'Sent',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export function statusColors(status: PurchaseOrderStatus): string {
  if (status === 'received') return 'bg-emerald-50 text-emerald-700';
  if (status === 'partially_received') return 'bg-amber-50 text-amber-700';
  if (status === 'ordered') return 'bg-blue-50 text-blue-700';
  if (status === 'cancelled') return 'bg-red-50 text-red-700';
  return 'bg-slate-100 text-slate-600';
}
