begin;

insert into public.modules (code, name, description) values
  (
    'promotions',
    'Advanced Promotions & Combos',
    'Create multi-item combo bundles, Buy X Get Y deals, volume tiered discounts, and scheduled happy-hour promotions.'
  )
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description;

insert into public.plan_modules (plan_id, module_id)
select p.id, m.id
from public.plans p cross join public.modules m
where m.code = 'promotions'
  and p.code in ('business', 'professional', 'growth', 'enterprise')
on conflict do nothing;

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  code text,
  description text,
  type text not null check (type in ('combo_bundle', 'buy_x_get_y', 'tiered_quantity', 'percentage_discount', 'fixed_discount')),
  combo_price numeric(12,2),
  discount_percentage numeric(5,2),
  discount_amount numeric(12,2),
  min_order_quantity integer default 1,
  start_date timestamptz,
  end_date timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.promotion_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  role text not null default 'combo_component' check (role in ('trigger_item', 'discounted_item', 'combo_component')),
  required_quantity integer not null default 1,
  created_at timestamptz not null default now()
);

commit;
