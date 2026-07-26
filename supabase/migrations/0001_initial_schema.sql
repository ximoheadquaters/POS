begin;

create extension if not exists pgcrypto;

create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled');
create type public.product_status as enum ('active', 'inactive');
create type public.shift_status as enum ('open', 'closed');
create type public.sale_status as enum ('held', 'completed', 'voided', 'partially_refunded', 'refunded');
create type public.payment_method as enum ('cash', 'card', 'ewallet');
create type public.payment_kind as enum ('payment', 'refund');
create type public.inventory_movement_type as enum ('opening', 'sale', 'return', 'adjustment', 'void');
create sequence public.receipt_number_seq;
create sequence public.return_number_seq;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 180),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  currency char(3) not null default 'PHP',
  timezone text not null default 'UTC',
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price_monthly numeric(14,2) not null default 0 check (price_monthly >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.plan_modules (
  plan_id uuid not null references public.plans(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  primary key (plan_id, module_id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete restrict,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status public.subscription_status not null default 'trialing',
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  enabled boolean not null,
  reason text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, module_id)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  code text not null,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, code),
  unique (id, organization_id)
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  role_id uuid not null,
  display_name text not null,
  email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email),
  unique (id, organization_id),
  foreign key (role_id, organization_id) references public.roles(id, organization_id) on delete restrict
);

create table public.user_branches (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id),
  foreign key (user_id, organization_id) references public.profiles(id, organization_id) on delete cascade,
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  category_id uuid,
  name text not null,
  sku text not null,
  description text,
  cost numeric(14,2) not null check (cost >= 0),
  selling_price numeric(14,2) not null check (selling_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  is_tax_inclusive boolean not null default false,
  status public.product_status not null default 'active',
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku),
  unique (id, organization_id),
  foreign key (category_id, organization_id) references public.categories(id, organization_id) on delete restrict
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  product_id uuid not null,
  name text not null,
  sku text not null,
  cost numeric(14,2),
  selling_price numeric(14,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku),
  unique (id, organization_id),
  foreign key (product_id, organization_id) references public.products(id, organization_id) on delete restrict
);

create table public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  product_id uuid not null,
  variant_id uuid,
  barcode text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, barcode),
  foreign key (product_id, organization_id) references public.products(id, organization_id) on delete cascade,
  foreign key (variant_id, organization_id) references public.product_variants(id, organization_id) on delete cascade
);

create table public.branch_inventory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  quantity integer not null default 0,
  low_stock_level integer not null default 5 check (low_stock_level >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (branch_id, product_id, variant_id),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (product_id, organization_id) references public.products(id, organization_id) on delete restrict,
  foreign key (variant_id, organization_id) references public.product_variants(id, organization_id) on delete restrict
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  movement_type public.inventory_movement_type not null,
  quantity_delta integer not null check (quantity_delta <> 0),
  quantity_after integer not null,
  reason text not null,
  reference_type text,
  reference_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (product_id, organization_id) references public.products(id, organization_id) on delete restrict,
  foreign key (variant_id, organization_id) references public.product_variants(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id) references public.profiles(id, organization_id) on delete restrict
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  email text,
  phone text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.registers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  name text not null,
  code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, code),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict
);

create table public.register_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  register_id uuid not null,
  cashier_id uuid not null,
  status public.shift_status not null default 'open',
  starting_cash numeric(14,2) not null check (starting_cash >= 0),
  cash_sales numeric(14,2) not null default 0,
  expected_cash numeric(14,2),
  actual_cash numeric(14,2),
  variance numeric(14,2),
  notes text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (register_id, organization_id) references public.registers(id, organization_id) on delete restrict,
  foreign key (cashier_id, organization_id) references public.profiles(id, organization_id) on delete restrict,
  check ((status = 'open' and closed_at is null) or status = 'closed')
);
create unique index one_open_shift_per_register on public.register_shifts(register_id) where status = 'open';
create unique index one_open_shift_per_cashier on public.register_shifts(cashier_id) where status = 'open';

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  shift_id uuid not null,
  type text not null check (type in ('cash_in', 'cash_out')),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (shift_id, organization_id) references public.register_shifts(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id) references public.profiles(id, organization_id) on delete restrict
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  cashier_id uuid not null,
  customer_id uuid,
  receipt_number text not null,
  idempotency_key text not null,
  status public.sale_status not null default 'completed',
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  total numeric(14,2) not null check (total >= 0),
  cost_total numeric(14,2) not null check (cost_total >= 0),
  change_due numeric(14,2) not null default 0 check (change_due >= 0),
  note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, receipt_number),
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (register_id, organization_id) references public.registers(id, organization_id) on delete restrict,
  foreign key (shift_id, organization_id) references public.register_shifts(id, organization_id) on delete restrict,
  foreign key (cashier_id, organization_id) references public.profiles(id, organization_id) on delete restrict,
  foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete restrict
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sale_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  product_name text not null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  returned_quantity integer not null default 0 check (returned_quantity between 0 and quantity),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (sale_id, organization_id) references public.sales(id, organization_id) on delete restrict,
  foreign key (product_id, organization_id) references public.products(id, organization_id) on delete restrict,
  foreign key (variant_id, organization_id) references public.product_variants(id, organization_id) on delete restrict
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sale_id uuid not null,
  method public.payment_method not null,
  kind public.payment_kind not null default 'payment',
  amount numeric(14,2) not null check (amount > 0),
  tendered numeric(14,2),
  reference text,
  created_at timestamptz not null default now(),
  foreign key (sale_id, organization_id) references public.sales(id, organization_id) on delete restrict
);

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  sale_id uuid not null,
  return_number text not null,
  reason text not null,
  refund_method public.payment_method not null,
  refund_total numeric(14,2) not null check (refund_total > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, return_number),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (sale_id, organization_id) references public.sales(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id) references public.profiles(id, organization_id) on delete restrict
);

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  return_id uuid not null,
  sale_item_id uuid not null,
  quantity integer not null check (quantity > 0),
  refund_amount numeric(14,2) not null check (refund_amount > 0),
  created_at timestamptz not null default now(),
  foreign key (return_id, organization_id) references public.returns(id, organization_id) on delete restrict,
  foreign key (sale_item_id, organization_id) references public.sale_items(id, organization_id) on delete restrict
);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  business_name text not null,
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  receipt_header text not null default '',
  receipt_footer text not null default '',
  allow_negative_inventory boolean not null default false,
  payment_methods public.payment_method[] not null default array['cash','card','ewallet']::public.payment_method[],
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid,
  actor_id uuid not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (actor_id, organization_id) references public.profiles(id, organization_id) on delete restrict
);

create index branches_org_idx on public.branches(organization_id);
create index profiles_org_idx on public.profiles(organization_id);
create index products_search_idx on public.products(organization_id, status, lower(name));
create index barcodes_lookup_idx on public.product_barcodes(organization_id, barcode);
create index inventory_branch_idx on public.branch_inventory(organization_id, branch_id);
create index inventory_movements_history_idx on public.inventory_movements(organization_id, branch_id, product_id, created_at desc);
create index customers_search_idx on public.customers(organization_id, lower(name));
create index sales_history_idx on public.sales(organization_id, branch_id, completed_at desc);
create index sales_cashier_idx on public.sales(organization_id, cashier_id, completed_at desc);
create index payments_method_idx on public.payments(organization_id, method, created_at);
create index audit_history_idx on public.audit_logs(organization_id, created_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'organizations','plans','subscriptions','branches','profiles','categories','products',
    'product_variants','branch_inventory','customers','registers','register_shifts','sales'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name, table_name
    );
  end loop;
end $$;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.can_access_branch(target_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and p.is_active
      and (
        r.code in ('owner', 'administrator')
        or exists (
          select 1 from public.user_branches ub
          where ub.user_id = p.id
            and ub.organization_id = p.organization_id
            and ub.branch_id = target_branch_id
        )
      )
  );
$$;

create or replace function public.prevent_ledger_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'completed financial and inventory ledger records are immutable';
end;
$$;

create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.prevent_ledger_mutation();

create trigger sale_items_no_delete
before delete on public.sale_items
for each row execute function public.prevent_ledger_mutation();

create trigger payments_immutable
before update or delete on public.payments
for each row execute function public.prevent_ledger_mutation();

create trigger returns_immutable
before update or delete on public.returns
for each row execute function public.prevent_ledger_mutation();

create trigger return_items_immutable
before update or delete on public.return_items
for each row execute function public.prevent_ledger_mutation();

create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function public.prevent_ledger_mutation();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'subscriptions','organization_modules','branches','roles','profiles',
    'user_branches','categories','products','product_variants','product_barcodes',
    'branch_inventory','inventory_movements','customers','registers','register_shifts',
    'cash_movements','sales','sale_items','payments','returns','return_items',
    'organization_settings','audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy tenant_read_%I on public.%I for select using (organization_id = public.current_organization_id())',
      table_name, table_name
    );
  end loop;
end $$;

alter table public.organizations enable row level security;
create policy tenant_read_organizations on public.organizations for select
  using (id = public.current_organization_id());

create policy service_manage_organizations on public.organizations for all
  using (id = public.current_organization_id())
  with check (id = public.current_organization_id());

create policy user_update_own_profile on public.profiles for update
  using (id = auth.uid() and organization_id = public.current_organization_id())
  with check (id = auth.uid() and organization_id = public.current_organization_id());

commit;
