# Feature status

## Implemented

- npm workspace monorepo, shared TypeScript/Zod contracts, lint/format/type/test/build scripts
- Supabase Auth login, logout, session restoration, protected routes, current user, reset request
- Derived tenant context, RLS defense, branch access, permissions, plan modules, organization
  overrides
- Organization profile/settings, branches, assignments, users/roles, and audit reads
- Categories, products, barcode search, basic variants, pagination, and price audit
- Per-branch inventory, low-stock threshold, manual adjustments, immutable movement history, and
  negative-stock default prevention
- Registers, open/close shifts, cash in/out service, expected/actual cash and variance
- Cashier cart, fixed discount, cash/card/e-wallet split payment, tender/change, optional customer,
  atomic checkout, inventory deduction, receipt result/details, history filters, and idempotency
- Full/partial returns, sold-quantity cap, inventory restoration, refund record, original sale
  preservation
- Customer CRUD endpoints and customer purchase/return history
- Dashboard/report API for sales, transaction count, average, payment method, best sellers, low
  stock, branches, and recorded-cost gross profit
- Seeded plans/modules, organization, two branches, three categories, 20 barcode products, different
  branch inventory, and one register per branch
- Optional hardware module catalog for barcode scanners, receipt printers, cash drawers, payment
  terminals, and customer displays; organization overrides and device-driver status are independent
- Hardware status screen, keyboard-wedge barcode scanning, and guarded adapter hooks for receipt
  printing, drawer opening, payment terminals, and customer displays
- Secure idempotent demo Auth provisioning script
- Automated tests for money exactness, tenant scoping, branch/module denial, checkout creation,
  inventory deduction, rollback, idempotency, stock shortage, split equality, return limits, register
  variance, and mobile cart behavior

## Foundation present; UI can be expanded

- Product image storage bucket/path policy exists; the product form accepts an image path. A polished
  camera/gallery picker, compression, signed upload progress, and cached thumbnail component remain.
- Category and variant APIs are functional; dedicated edit screens can be added.
- Customer update/history endpoints are functional; the first mobile screen focuses on search/create.
- Cash movement API is functional; the first register screen focuses on opening and closing.
- Sales filtering is implemented in the API; the first mobile history view fixes the selected branch
  and can add date/payment controls.
- Permission/branch update API is functional; the first users screen is read-oriented.
- Receipt data and print action are driver-ready; the manufacturer-specific printer driver remains
  dependent on the selected terminal model.

## Deferred by scope

- Public third-party API
- E-commerce and accounting integrations
- Loyalty rewards and gift cards
- Advanced promotions
- Full offline synchronization / Expo SQLite
- Restaurant and pharmacy workflows
- Manufacturer-specific printer, drawer, terminal, scanner, and customer-display drivers
- Supplier, purchasing, expense, promotion, loyalty, and integration business implementations

The extension approach for these items is documented in `architecture.md`.
