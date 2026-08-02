# Feature status

## Implemented

- npm workspace monorepo, shared TypeScript/Zod contracts, lint/format/type/test/build scripts
- Supabase Auth login, logout, session restoration, protected routes, current user, reset request
- Derived tenant context, RLS defense, branch access, permissions, plan modules, organization
  overrides
- Organization profile/settings, responsive branch management with operational counts and safe
  activation controls, branch assignments, employee account creation and editing, role permission
  matrix management, account activation controls, and audit reads
- Categories, brands, configurable units, products, barcode search, complete selling-unit variant
  management, prepared-product BOM costing, pagination, and price audit
- Per-branch inventory, low-stock threshold, manual adjustments, immutable movement history,
  negative-stock default prevention, and sealed-container/opened-portion pools. Whole-container
  sales, portion sales, BOM deductions, purchasing, returns, and branch transfers preserve the
  correct stock pool; staff explicitly open a container before its contents can be portioned.
- Supplier directory, purchase-order drafts and sending, partial/full stock receiving, pack/box
  conversion into base inventory, supplier returns with refund/replacement/credit resolution,
  incoming-product registration and first-receipt activation, receiving/return history,
  inventory-ledger posting, role controls, and audit logs
- Registers, open/close shifts, cash in/out controls, cash-refund accountability, historical shift
  reports, payment breakdowns, expected/actual cash and variance
- Cashier cart, fixed discount, cash/card/e-wallet split payment, tender/change, optional customer,
  atomic checkout, inventory deduction, receipt result/details, history filters, and idempotency
- Full/partial returns, sold-quantity cap, inventory restoration, refund record, original sale
  preservation
- Customer CRUD endpoints and customer purchase/return history
- Consolidated, branch-scoped reporting hub with executive KPIs plus sales, payment, product,
  category, branch, inventory valuation/alerts/movements, purchasing, supplier, payable, profit,
  cash, and shift reports; date presets and shift drill-down are included. Reports can be exported
  as a paginated PDF or a six-sheet Excel workbook on web, iOS, and Android.
- Seeded plans/modules, organization, two branches, three categories, 20 barcode products, different
  branch inventory, and one register per branch
- Optional hardware module catalog for barcode scanners, receipt printers, cash drawers, payment
  terminals, and customer displays; organization overrides and device-driver status are independent
- Hardware status screen, keyboard-wedge barcode scanning, and guarded adapter hooks for receipt
  printing, drawer opening, payment terminals, and customer displays
- Web and mobile offline branch snapshots, cached catalogue/inventory/customer/register data,
  persistent cash-sale outbox, automatic retry, failed-sale resolution, and manual sync controls
- Secure idempotent demo Auth provisioning script
- Automated tests for money exactness, tenant scoping, branch/module denial, checkout creation,
  inventory deduction, rollback, idempotency, stock shortage, split equality, return limits, register
  variance, and mobile cart behavior

## Foundation present; UI can be expanded

- Product image storage bucket/path policy exists; the product form accepts an image path. A polished
  camera/gallery picker, compression, signed upload progress, and cached thumbnail component remain.
- Customer update/history endpoints are functional; the first mobile screen focuses on search/create.
- Sales filtering is implemented in the API; the first mobile history view fixes the selected branch
  and can add date/payment controls.
- Receipt data and print action are driver-ready; the manufacturer-specific printer driver remains
  dependent on the selected terminal model.

## Deferred by scope

- Public third-party API
- E-commerce and accounting integrations
- Loyalty rewards and gift cards
- Advanced promotions
- Restaurant and pharmacy workflows
- Manufacturer-specific printer, drawer, terminal, scanner, and customer-display drivers
- Expense, promotion, loyalty, and integration business implementations

The extension approach for these items is documented in `architecture.md`.
