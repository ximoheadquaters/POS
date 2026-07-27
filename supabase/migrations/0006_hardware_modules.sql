begin;

-- Hardware capabilities are intentionally not assigned to any plan. They remain
-- disabled until the platform administrator enables an organization override.
insert into public.modules (code, name, description) values
  (
    'barcode_scanner',
    'Barcode Scanner',
    'Accept barcodes from a keyboard-wedge scanner or a configured native scanner driver.'
  ),
  (
    'receipt_printer',
    'Receipt Printer',
    'Print completed sales through a configured embedded or external receipt printer.'
  ),
  (
    'cash_drawer',
    'Cash Drawer',
    'Open a connected cash drawer after eligible cash sales.'
  ),
  (
    'payment_terminal',
    'Payment Terminal',
    'Send card payments to a configured certified payment-terminal integration.'
  ),
  (
    'customer_display',
    'Customer Display',
    'Mirror cart totals and checkout progress to a connected customer-facing display.'
  )
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description;

commit;
