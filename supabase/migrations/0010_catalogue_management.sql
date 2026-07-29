begin;

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table if not exists public.product_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_-]{0,23}$'),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'discrete' check (kind in ('discrete', 'decimal')),
  default_step numeric(14,3) not null default 1 check (default_step > 0),
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

insert into public.product_units (
  organization_id, code, name, kind, default_step, is_system
)
select o.id, seed.code, seed.name, seed.kind, seed.default_step, true
from public.organizations o
cross join (
  values
    ('piece', 'Piece', 'discrete', 1.000),
    ('serving', 'Serving', 'discrete', 1.000),
    ('box', 'Box', 'discrete', 1.000),
    ('pack', 'Pack', 'discrete', 1.000),
    ('ml', 'Milliliter', 'decimal', 100.000),
    ('l', 'Liter', 'decimal', 0.100),
    ('g', 'Gram', 'decimal', 100.000),
    ('kg', 'Kilogram', 'decimal', 0.100)
) as seed(code, name, kind, default_step)
on conflict (organization_id, code) do nothing;

alter table public.products
  add column if not exists brand_id uuid;

alter table public.products
  drop constraint if exists products_brand_organization_fkey;

alter table public.products
  add constraint products_brand_organization_fkey
  foreign key (brand_id, organization_id)
  references public.brands(id, organization_id) on delete restrict;

alter table public.products drop constraint if exists products_unit_check;
alter table public.product_variants drop constraint if exists product_variants_unit_check;

create index if not exists brands_organization_idx
  on public.brands(organization_id, is_active, lower(name));
create index if not exists product_units_organization_idx
  on public.product_units(organization_id, is_active, name);
create index if not exists products_brand_idx
  on public.products(organization_id, brand_id);

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at
before update on public.brands
for each row execute function public.set_updated_at();

drop trigger if exists product_units_set_updated_at on public.product_units;
create trigger product_units_set_updated_at
before update on public.product_units
for each row execute function public.set_updated_at();

alter table public.brands enable row level security;
alter table public.product_units enable row level security;

drop policy if exists tenant_read_brands on public.brands;
create policy tenant_read_brands on public.brands for select
  using (organization_id = public.current_organization_id());

drop policy if exists tenant_read_product_units on public.product_units;
create policy tenant_read_product_units on public.product_units for select
  using (organization_id = public.current_organization_id());

commit;
