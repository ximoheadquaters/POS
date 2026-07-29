begin;

alter type public.inventory_movement_type add value if not exists 'purchase_receipt';
alter type public.inventory_movement_type add value if not exists 'purchase_return';

create type public.purchase_order_status as enum (
  'draft', 'ordered', 'partially_received', 'received', 'cancelled'
);
create type public.purchase_return_resolution as enum (
  'refund', 'replacement', 'supplier_credit'
);

create sequence public.purchase_order_number_seq;
create sequence public.stock_receipt_number_seq;
create sequence public.purchase_return_number_seq;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  tax_id text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  supplier_id uuid not null,
  order_number text not null,
  status public.purchase_order_status not null default 'draft',
  expected_at timestamptz,
  supplier_reference text,
  notes text,
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  created_by uuid not null,
  ordered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, order_number),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (supplier_id, organization_id) references public.suppliers(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id) references public.profiles(id, organization_id) on delete restrict
);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  purchase_order_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  product_name text not null,
  sku text not null,
  purchase_unit text not null,
  units_per_base numeric(14,3) not null check (units_per_base > 0),
  ordered_quantity numeric(14,3) not null check (ordered_quantity > 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  returned_quantity numeric(14,3) not null default 0 check (returned_quantity >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (purchase_order_id, organization_id) references public.purchase_orders(id, organization_id) on delete restrict,
  foreign key (product_id, organization_id) references public.products(id, organization_id) on delete restrict,
  foreign key (variant_id, organization_id) references public.product_variants(id, organization_id) on delete restrict,
  check (received_quantity <= ordered_quantity),
  check (returned_quantity <= received_quantity)
);

create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  purchase_order_id uuid not null,
  receipt_number text not null,
  supplier_invoice_number text,
  notes text,
  received_by uuid not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, receipt_number),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (purchase_order_id, organization_id) references public.purchase_orders(id, organization_id) on delete restrict,
  foreign key (received_by, organization_id) references public.profiles(id, organization_id) on delete restrict
);

create table public.stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  stock_receipt_id uuid not null,
  purchase_order_item_id uuid not null,
  purchase_quantity numeric(14,3) not null check (purchase_quantity > 0),
  base_quantity numeric(14,3) not null check (base_quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  foreign key (stock_receipt_id, organization_id) references public.stock_receipts(id, organization_id) on delete restrict,
  foreign key (purchase_order_item_id, organization_id) references public.purchase_order_items(id, organization_id) on delete restrict
);

create table public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  supplier_id uuid not null,
  purchase_order_id uuid not null,
  return_number text not null,
  reason text not null,
  resolution public.purchase_return_resolution not null,
  supplier_reference text,
  notes text,
  total numeric(14,2) not null check (total >= 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, return_number),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (supplier_id, organization_id) references public.suppliers(id, organization_id) on delete restrict,
  foreign key (purchase_order_id, organization_id) references public.purchase_orders(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id) references public.profiles(id, organization_id) on delete restrict
);

create table public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  purchase_return_id uuid not null,
  purchase_order_item_id uuid not null,
  purchase_quantity numeric(14,3) not null check (purchase_quantity > 0),
  base_quantity numeric(14,3) not null check (base_quantity > 0),
  refund_amount numeric(14,2) not null check (refund_amount >= 0),
  created_at timestamptz not null default now(),
  foreign key (purchase_return_id, organization_id) references public.purchase_returns(id, organization_id) on delete restrict,
  foreign key (purchase_order_item_id, organization_id) references public.purchase_order_items(id, organization_id) on delete restrict
);

create index suppliers_org_idx on public.suppliers(organization_id, is_active, lower(name));
create index purchase_orders_history_idx on public.purchase_orders(organization_id, branch_id, created_at desc);
create index purchase_orders_supplier_idx on public.purchase_orders(organization_id, supplier_id, created_at desc);
create index stock_receipts_order_idx on public.stock_receipts(organization_id, purchase_order_id, received_at desc);
create index purchase_returns_order_idx on public.purchase_returns(organization_id, purchase_order_id, created_at desc);

create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();
create trigger purchase_orders_set_updated_at before update on public.purchase_orders
for each row execute function public.set_updated_at();

create trigger stock_receipts_immutable before update or delete on public.stock_receipts
for each row execute function public.prevent_ledger_mutation();
create trigger stock_receipt_items_immutable before update or delete on public.stock_receipt_items
for each row execute function public.prevent_ledger_mutation();
create trigger purchase_returns_immutable before update or delete on public.purchase_returns
for each row execute function public.prevent_ledger_mutation();
create trigger purchase_return_items_immutable before update or delete on public.purchase_return_items
for each row execute function public.prevent_ledger_mutation();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'suppliers','purchase_orders','purchase_order_items','stock_receipts',
    'stock_receipt_items','purchase_returns','purchase_return_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy tenant_read_%I on public.%I for select using (organization_id = public.current_organization_id())',
      table_name, table_name
    );
  end loop;
end $$;

insert into public.permissions (code,description) values
  ('suppliers:read','View suppliers'),
  ('suppliers:manage','Create and update suppliers'),
  ('purchasing:read','View purchase orders, receipts, and supplier returns'),
  ('purchasing:manage','Create, send, and cancel purchase orders'),
  ('purchasing:receive','Receive stock from suppliers'),
  ('purchasing:return','Return received stock to suppliers')
on conflict (code) do update set description=excluded.description;

insert into public.plan_modules (plan_id,module_id)
select p.id,m.id
from public.plans p cross join public.modules m
where p.code in ('business','professional','enterprise')
  and m.code in ('suppliers','purchasing')
on conflict do nothing;

insert into public.role_permissions (role_id,permission_id)
select r.id,p.id
from public.roles r cross join public.permissions p
where p.code in (
  'suppliers:read','suppliers:manage','purchasing:read','purchasing:manage',
  'purchasing:receive','purchasing:return'
) and (
  r.code in ('owner','administrator','manager')
  or (r.code='inventory_staff' and p.code in (
    'suppliers:read','purchasing:read','purchasing:receive','purchasing:return'
  ))
)
on conflict do nothing;

commit;
