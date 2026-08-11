begin;

-- Production-safe reference catalogue for a clean Ximo platform installation.
-- This intentionally contains no organizations, users, branches, products,
-- inventory, or sales. Real businesses must be created through the platform
-- provisioning API after the schema has been installed.

insert into public.applications (code, name, description)
values (
  'ximo_pos',
  'Ximo POS',
  'Point of sale, catalogue, purchasing, inventory, branch operations and reporting.'
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = true,
  updated_at = now();

insert into public.modules (application_id, code, name, description)
select application.id, module.code, module.name, module.description
from public.applications application
cross join (
  values
    ('dashboard', 'Dashboard', 'Business performance and operating overview.'),
    ('pos', 'Point of Sale', 'Checkout, payments, receipts, and held sales.'),
    ('products', 'Products', 'Product catalogue, variants, units, and pricing.'),
    ('inventory', 'Inventory', 'Branch stock, movements, counts, and adjustments.'),
    ('customers', 'Customers', 'Customer directory, groups, and accounts.'),
    ('returns', 'Returns', 'Customer returns, exchanges, and refunds.'),
    ('registers', 'Registers', 'Registers, cashier shifts, and cash movements.'),
    ('reports', 'Reports', 'Operational, financial, and management reporting.'),
    ('suppliers', 'Suppliers', 'Supplier directory and purchasing relationships.'),
    ('purchasing', 'Purchasing', 'Purchase orders, receiving, payments, and supplier returns.'),
    ('stock_transfers', 'Stock Transfers', 'Controlled inventory transfers between branches.'),
    ('expenses', 'Expenses', 'Business expense recording and reporting.'),
    ('promotions', 'Promotions', 'Discounts, promotions, and product combos.'),
    ('loyalty', 'Loyalty', 'Customer loyalty and rewards.'),
    ('integrations', 'Integrations', 'External accounting, commerce, API, and webhook integrations.'),
    ('audit', 'Audit Logs', 'Security and operational audit history.'),
    ('barcode_scanner', 'Barcode Scanner', 'Barcode scanning hardware capability.'),
    ('receipt_printer', 'Receipt Printer', 'Receipt printing hardware capability.'),
    ('cash_drawer', 'Cash Drawer', 'Cash drawer hardware capability.'),
    ('payment_terminal', 'Payment Terminal', 'Integrated payment terminal capability.'),
    ('customer_display', 'Customer Display', 'Customer-facing checkout display capability.')
) as module(code, name, description)
where application.code = 'ximo_pos'
on conflict (code) do update set
  application_id = excluded.application_id,
  name = excluded.name,
  description = excluded.description;

insert into public.plans (
  application_id, code, name, description, price_monthly,
  billing_interval, is_active, is_available_for_onboarding,
  allowed_onboarding_statuses
)
select application.id, plan.code, plan.name, plan.description,
  plan.price_monthly, 'monthly', true, true,
  array['trialing', 'active']::public.subscription_status[]
from public.applications application
cross join (
  values
    ('starter', 'Starter', 'Essential POS operations for a small store.', 499::numeric),
    ('business', 'Business', 'Purchasing, suppliers, transfers, and reporting for a growing business.', 999::numeric),
    ('professional', 'Professional', 'Advanced operations, controls, and analytics for established businesses.', 1999::numeric),
    ('enterprise', 'Enterprise', 'Complete Ximo POS access for complex and multi-branch organizations.', 4999::numeric)
) as plan(code, name, description, price_monthly)
where application.code = 'ximo_pos'
on conflict (code) do update set
  application_id = excluded.application_id,
  name = excluded.name,
  description = excluded.description,
  price_monthly = excluded.price_monthly,
  billing_interval = excluded.billing_interval,
  is_active = excluded.is_active,
  is_available_for_onboarding = excluded.is_available_for_onboarding,
  allowed_onboarding_statuses = excluded.allowed_onboarding_statuses,
  updated_at = now();

insert into public.plan_modules (plan_id, module_id)
select plan.id, module.id
from public.plans plan
join public.applications application
  on application.id = plan.application_id and application.code = 'ximo_pos'
join public.modules module on module.application_id = application.id
where module.code not in (
  'barcode_scanner', 'receipt_printer', 'cash_drawer',
  'payment_terminal', 'customer_display'
)
and (
  (plan.code = 'starter' and module.code in (
    'dashboard', 'pos', 'products', 'inventory', 'customers', 'returns', 'registers'
  ))
  or (plan.code = 'business' and module.code in (
    'dashboard', 'pos', 'products', 'inventory', 'customers', 'returns', 'registers',
    'reports', 'suppliers', 'purchasing', 'stock_transfers'
  ))
  or (plan.code = 'professional' and module.code <> 'integrations')
  or plan.code = 'enterprise'
)
on conflict (plan_id, module_id) do nothing;

insert into public.permissions (code, description)
values
  ('organization:read', 'View organization'),
  ('organization:update', 'Update organization'),
  ('branches:read', 'View branches'),
  ('branches:manage', 'Manage branches'),
  ('users:read', 'View users'),
  ('users:manage', 'Manage users'),
  ('products:read', 'View products'),
  ('products:manage', 'Manage products'),
  ('inventory:read', 'View inventory'),
  ('inventory:adjust', 'Adjust inventory'),
  ('transfers:read', 'View stock transfers'),
  ('transfers:manage', 'Manage stock transfers'),
  ('transfers:receive', 'Receive stock transfers'),
  ('suppliers:read', 'View suppliers'),
  ('suppliers:manage', 'Manage suppliers'),
  ('purchasing:read', 'View purchasing'),
  ('purchasing:manage', 'Manage purchase orders'),
  ('purchasing:receive', 'Receive supplier stock'),
  ('purchasing:return', 'Return supplier stock'),
  ('purchasing:pay', 'Record supplier payments'),
  ('registers:read', 'View registers'),
  ('registers:manage', 'Manage registers'),
  ('shifts:open', 'Open shifts'),
  ('shifts:close', 'Close shifts'),
  ('cash:move', 'Record cash movements'),
  ('sales:create', 'Complete sales'),
  ('sales:read_branch', 'View branch sales'),
  ('sales:read_all', 'View all sales'),
  ('returns:create', 'Create returns'),
  ('returns:manage', 'Manage refund approvals'),
  ('customers:read', 'View customers'),
  ('customers:manage', 'Manage customers'),
  ('promotions:read', 'View promotions'),
  ('promotions:manage', 'Manage promotions and combos'),
  ('reports:read', 'View reports'),
  ('reports:view_cost', 'View cost of goods and inventory valuation in reports'),
  ('reports:view_profit', 'View gross profit and margin in reports'),
  ('reports:view_all_branches', 'View report data across all organization branches'),
  ('reports:export', 'Export reports'),
  ('reports:manage_saved_views', 'Create and manage saved report views'),
  ('reports:view_staff', 'View staff attribution in reports'),
  ('reports:view_tax', 'View tax breakdowns in reports'),
  ('reports:view_platform', 'View platform-level reporting diagnostics'),
  ('settings:manage', 'Manage settings'),
  ('audit:read', 'View audit log'),
  ('modules:manage', 'Manage module overrides')
on conflict (code) do update set description = excluded.description;

-- Migration 0032 backfills entitlements from pre-existing modules. A fresh
-- database receives its modules here, so repeat that deterministic projection.
insert into public.application_entitlements (
  application_id, code, name, description, value_type
)
select module.application_id, 'module.' || module.code, module.name,
  module.description, 'boolean'
from public.modules module
join public.applications application on application.id = module.application_id
where application.code = 'ximo_pos'
on conflict (application_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

insert into public.plan_entitlements (plan_id, entitlement_id, value)
select plan_module.plan_id, entitlement.id, 'true'::jsonb
from public.plan_modules plan_module
join public.modules module on module.id = plan_module.module_id
join public.application_entitlements entitlement
  on entitlement.application_id = module.application_id
 and entitlement.code = 'module.' || module.code
on conflict (plan_id, entitlement_id) do update set
  value = excluded.value,
  updated_at = now();

commit;
