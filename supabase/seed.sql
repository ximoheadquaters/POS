-- Structural development data. Auth users must be created through Supabase Auth first;
-- see docs/demo-users.md for the safe procedure that binds their generated UUIDs.
begin;

insert into public.modules (code, name) values
  ('dashboard','Dashboard'), ('pos','Point of Sale'), ('products','Products'),
  ('inventory','Inventory'), ('customers','Customers'), ('returns','Returns'),
  ('registers','Registers'), ('reports','Reports'), ('suppliers','Suppliers'),
  ('purchasing','Purchasing'), ('stock_transfers','Stock Transfers'), ('expenses','Expenses'), ('promotions','Promotions'),
  ('loyalty','Loyalty'), ('integrations','Integrations'), ('audit','Audit Logs'),
  ('barcode_scanner','Barcode Scanner'), ('receipt_printer','Receipt Printer'),
  ('cash_drawer','Cash Drawer'), ('payment_terminal','Payment Terminal'),
  ('customer_display','Customer Display')
on conflict (code) do nothing;

insert into public.plans (code, name, price_monthly) values
  ('starter','Starter',499), ('business','Business',999),
  ('professional','Professional',1999), ('enterprise','Enterprise',4999)
on conflict (code) do nothing;

insert into public.plan_modules (plan_id, module_id)
select p.id, m.id from public.plans p cross join public.modules m
where m.code not in (
  'barcode_scanner','receipt_printer','cash_drawer','payment_terminal','customer_display'
) and (
  (p.code = 'starter' and m.code in ('dashboard','pos','products','inventory','customers','returns','registers'))
  or (p.code = 'business' and m.code in (
    'dashboard','pos','products','inventory','customers','returns','registers','reports',
    'suppliers','purchasing','stock_transfers'
  ))
  or (p.code = 'professional' and m.code not in ('integrations'))
  or p.code = 'enterprise'
)
on conflict do nothing;

insert into public.permissions (code, description) values
  ('organization:read','View organization'), ('organization:update','Update organization'),
  ('branches:read','View branches'), ('branches:manage','Manage branches'),
  ('users:read','View users'), ('users:manage','Manage users'),
  ('products:read','View products'), ('products:manage','Manage products'),
  ('inventory:read','View inventory'), ('inventory:adjust','Adjust inventory'),
  ('transfers:read','View stock transfers'), ('transfers:manage','Manage stock transfers'), ('transfers:receive','Receive stock transfers'),
  ('suppliers:read','View suppliers'), ('suppliers:manage','Manage suppliers'),
  ('purchasing:read','View purchasing'), ('purchasing:manage','Manage purchase orders'),
  ('purchasing:receive','Receive supplier stock'), ('purchasing:return','Return supplier stock'), ('purchasing:pay','Record supplier payments'),
  ('registers:read','View registers'), ('registers:manage','Manage registers'),
  ('shifts:open','Open shifts'), ('shifts:close','Close shifts'), ('cash:move','Record cash movements'),
  ('sales:create','Complete sales'), ('sales:read_branch','View branch sales'), ('sales:read_all','View all sales'),
  ('returns:create','Create returns'), ('returns:manage','Manage refund approvals'), ('customers:read','View customers'),
  ('customers:manage','Manage customers'), ('promotions:read','View promotions'), ('promotions:manage','Manage promotions and combos'),
  ('reports:read','View reports'),
  ('reports:view_cost','View cost of goods and inventory valuation in reports'),
  ('reports:view_profit','View gross profit and margin in reports'),
  ('reports:view_all_branches','View report data across all organization branches'),
  ('reports:export','Export reports'),
  ('reports:manage_saved_views','Create and manage saved report views'),
  ('reports:view_staff','View staff attribution in reports'),
  ('reports:view_tax','View tax breakdowns in reports'),
  ('reports:view_platform','View platform-level reporting diagnostics'),
  ('settings:manage','Manage settings'), ('audit:read','View audit log'), ('modules:manage','Manage module overrides')
on conflict (code) do nothing;

insert into public.organizations (id, name, slug, currency, timezone)
values ('10000000-0000-4000-8000-000000000001','Ximo Demo Retail','ximo-demo','PHP','Asia/Manila')
on conflict (id) do nothing;

insert into public.subscriptions (
  organization_id, application_id, plan_id, status, current_period_ends_at
)
select '10000000-0000-4000-8000-000000000001', application_id, id,
  'active', now() + interval '1 year'
from public.plans where code = 'business'
on conflict (organization_id, application_id) do nothing;

insert into public.organization_settings (
  organization_id, business_name, tax_rate, receipt_header, receipt_footer,
  allow_negative_inventory, payment_methods
) values (
  '10000000-0000-4000-8000-000000000001','Ximo Demo Retail',12,
  'Ximo Demo Retail', 'Thank you for shopping with us!', false,
  array['cash','card','ewallet']::public.payment_method[]
) on conflict (organization_id) do nothing;

insert into public.branches (id, organization_id, name, code, address) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Bacolod Branch','BCD','Bacolod City'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Talisay Branch','TLS','Talisay City')
on conflict (id) do nothing;

insert into public.roles (id, organization_id, code, name, is_system) values
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner','Owner',true),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','administrator','Administrator',true),
  ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','manager','Manager',true),
  ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','cashier','Cashier',true),
  ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','inventory_staff','Inventory Staff',true)
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.organization_id = '10000000-0000-4000-8000-000000000001'
and (
  r.code in ('owner','administrator')
  or (r.code = 'manager' and p.code not in ('modules:manage'))
  or (r.code = 'cashier' and p.code in (
    'branches:read','products:read','inventory:read','registers:read','shifts:open',
    'shifts:close','cash:move','sales:create','sales:read_branch','customers:read',
    'reports:read'
  ))
  or (r.code = 'inventory_staff' and p.code in (
    'branches:read','products:read','products:manage','inventory:read','inventory:adjust',
    'suppliers:read','purchasing:read','purchasing:receive','purchasing:return'
  ))
) on conflict do nothing;

insert into public.categories (id, organization_id, name) values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Beverages'),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Snacks'),
  ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Household')
on conflict (id) do nothing;

with product_data(category_no, product_no, name, cost, price) as (
  values
    (1,1,'Bottled Water 500ml',10,15), (1,2,'Cola 330ml',18,25),
    (1,3,'Orange Soda 330ml',18,25), (1,4,'Iced Tea 500ml',22,32),
    (1,5,'Instant Coffee Sachet',5,8), (1,6,'Chocolate Drink 250ml',15,22),
    (1,7,'Energy Drink 250ml',28,40), (2,8,'Potato Chips Original',20,30),
    (2,9,'Potato Chips BBQ',20,30), (2,10,'Chocolate Bar',18,28),
    (2,11,'Crackers Pack',12,18), (2,12,'Peanuts 100g',16,24),
    (2,13,'Cookies 120g',24,35), (2,14,'Cup Noodles',22,32),
    (3,15,'Dishwashing Liquid 250ml',30,42), (3,16,'Laundry Detergent 500g',45,62),
    (3,17,'Bath Soap',18,27), (3,18,'Shampoo Sachet',5,8),
    (3,19,'Toilet Tissue 4-roll',55,72), (3,20,'Trash Bags 10-pack',35,49)
)
insert into public.products (
  id, organization_id, category_id, name, sku, cost, selling_price, tax_rate
)
select
  ('50000000-0000-4000-8000-' || lpad(product_no::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001',
  ('40000000-0000-4000-8000-' || lpad(category_no::text, 12, '0'))::uuid,
  name, 'SKU-' || lpad(product_no::text, 4, '0'), cost, price, 12
from product_data
on conflict (id) do nothing;

insert into public.product_barcodes (organization_id, product_id, barcode)
select organization_id, id, '48000000' || lpad(row_number() over (order by sku)::text, 5, '0')
from public.products where organization_id = '10000000-0000-4000-8000-000000000001'
on conflict (organization_id, barcode) do nothing;

insert into public.branch_inventory (
  organization_id, branch_id, product_id, quantity, low_stock_level
)
select p.organization_id, b.id, p.id,
  case when b.code = 'BCD' then 30 + (row_number() over (partition by b.id order by p.sku) % 25)
       else 15 + (row_number() over (partition by b.id order by p.sku) % 20) end,
  8
from public.products p
cross join public.branches b
where p.organization_id = '10000000-0000-4000-8000-000000000001'
and b.organization_id = p.organization_id
on conflict (branch_id, product_id, variant_id) do nothing;

insert into public.registers (id, organization_id, branch_id, name, code) values
  ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Bacolod Counter 1','BCD-01'),
  ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Talisay Counter 1','TLS-01')
on conflict (id) do nothing;

commit;
