begin;

-- 1. Business profile column on organizations
alter table public.organizations
  add column if not exists business_profile text not null default 'retail';

alter table public.organizations
  drop constraint if exists organizations_business_profile_check;

alter table public.organizations
  add constraint organizations_business_profile_check
  check (business_profile in ('retail', 'food_service', 'hybrid'));

-- 2. Preparation behavior column on products
alter table public.products
  add column if not exists preparation_behavior text not null default 'standard';

alter table public.products
  drop constraint if exists products_preparation_behavior_check;

alter table public.products
  add constraint products_preparation_behavior_check
  check (preparation_behavior in ('standard', 'cook_to_order', 'preproduced'));

-- Populate existing products with recipes as cook_to_order
update public.products p
set preparation_behavior = 'cook_to_order'
where preparation_behavior = 'standard' and exists (
  select 1 from public.product_recipes pr
  where pr.organization_id = p.organization_id and pr.parent_product_id = p.id
);

create index if not exists products_organization_prep_behavior_idx
  on public.products (organization_id, preparation_behavior, status);

-- 3. Business Profile Modules lookup table
create table if not exists public.business_profile_modules (
  business_profile text not null check (business_profile in ('retail', 'food_service', 'hybrid')),
  module_id uuid not null references public.modules(id) on delete cascade,
  enabled_by_default boolean not null default true,
  primary key (business_profile, module_id)
);

create index if not exists idx_bpm_profile_module
  on public.business_profile_modules (business_profile, module_id);

alter table public.business_profile_modules enable row level security;

drop policy if exists "Allow authenticated read business profile modules" on public.business_profile_modules;
create policy "Allow authenticated read business profile modules"
  on public.business_profile_modules for select
  to authenticated
  using (true);

-- 4. Register new capability modules
insert into public.modules (code, name, description) values
  ('offline', 'Offline Mode', 'Offline cash transaction handling and local caching'),
  ('ingredients', 'Raw Ingredients', 'Raw inventory materials for food and recipe production'),
  ('recipes', 'Recipes & BOM', 'Bill of materials recipe templates and costing'),
  ('prepared_food', 'Prepared Food', 'Cooked-to-order preparation behavior and automatic ingredient deduction'),
  ('production', 'Batch Production', 'Preproduced item production batches and repacking'),
  ('held_sales', 'Held Sales Tabs', 'Parked checkout carts and order tabs'),
  ('food_waste', 'Food Waste Tracking', 'Planned food waste tracking'),
  ('order_types', 'Order Types', 'Planned dine-in, takeout, delivery flags'),
  ('tables', 'Table Management', 'Planned table floor map and management'),
  ('menu_modifiers', 'Menu Modifiers', 'Planned product modifiers and add-ons'),
  ('kitchen_tickets', 'Kitchen Tickets', 'Planned kitchen ticket printing'),
  ('kitchen_display', 'Kitchen Display System', 'Planned KDS screen integration'),
  ('order_status', 'Order Status Flow', 'Planned order preparation status workflow'),
  ('waiter_assignment', 'Waiter Assignment', 'Planned server table assignment'),
  ('split_bill', 'Split Bill', 'Planned bill splitting'),
  ('service_charge', 'Service Charge', 'Planned automatic service charges'),
  ('delivery_orders', 'Delivery Orders', 'Planned delivery courier integration')
on conflict (code) do nothing;

-- 5. Seed business_profile_modules for retail, food_service, and hybrid
-- Retail profile defaults
insert into public.business_profile_modules (business_profile, module_id, enabled_by_default)
select 'retail', m.id, true
from public.modules m
where m.code in (
  'dashboard', 'pos', 'products', 'inventory', 'customers', 'returns',
  'registers', 'reports', 'suppliers', 'purchasing', 'stock_transfers',
  'audit', 'offline', 'barcode_scanner', 'receipt_printer', 'cash_drawer'
)
on conflict (business_profile, module_id) do update set enabled_by_default = true;

-- Food Service profile defaults
insert into public.business_profile_modules (business_profile, module_id, enabled_by_default)
select 'food_service', m.id, true
from public.modules m
where m.code in (
  'dashboard', 'pos', 'products', 'inventory', 'customers', 'returns',
  'registers', 'reports', 'audit', 'offline', 'receipt_printer', 'cash_drawer',
  'suppliers', 'purchasing', 'stock_transfers',
  'ingredients', 'recipes', 'prepared_food', 'production', 'held_sales'
)
on conflict (business_profile, module_id) do update set enabled_by_default = true;

-- Hybrid profile defaults
insert into public.business_profile_modules (business_profile, module_id, enabled_by_default)
select 'hybrid', m.id, true
from public.modules m
where m.code in (
  'dashboard', 'pos', 'products', 'inventory', 'customers', 'returns',
  'registers', 'reports', 'suppliers', 'purchasing', 'stock_transfers',
  'audit', 'offline', 'barcode_scanner', 'receipt_printer', 'cash_drawer',
  'ingredients', 'recipes', 'prepared_food', 'production', 'held_sales'
)
on conflict (business_profile, module_id) do update set enabled_by_default = true;

-- 6. Ensure active plans grant implemented modules
insert into public.plan_modules (plan_id, module_id)
select p.id, m.id
from public.modules m
cross join public.plans p
where m.code in (
  'offline', 'ingredients', 'recipes', 'prepared_food', 'production', 'held_sales'
) and p.code in ('starter', 'business', 'professional', 'enterprise')
on conflict do nothing;

-- 7. Add partial unique index preventing multiple active/trialing subscriptions per organization
create unique index if not exists subscriptions_one_active_per_org_idx
  on public.subscriptions (organization_id)
  where status in ('trialing', 'active');

commit;
