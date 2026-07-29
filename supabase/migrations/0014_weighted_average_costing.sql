alter table public.branch_inventory
  add column if not exists inventory_value numeric(18,4) not null default 0,
  add column if not exists average_cost numeric(18,4) not null default 0;

update public.branch_inventory bi
set average_cost = round(p.cost::numeric, 4),
    inventory_value = round(bi.quantity::numeric * p.cost::numeric, 4)
from public.products p
where p.id = bi.product_id
  and p.organization_id = bi.organization_id
  and bi.variant_id is null
  and bi.average_cost = 0
  and bi.inventory_value = 0;

alter table public.branch_inventory
  drop constraint if exists branch_inventory_average_cost_check,
  add constraint branch_inventory_average_cost_check
    check (average_cost >= 0);

alter table public.organization_settings
  add column if not exists target_margin_percent numeric(5,2) not null default 25
    check (target_margin_percent >= 0 and target_margin_percent < 100),
  add column if not exists low_margin_threshold_percent numeric(5,2) not null default 15
    check (
      low_margin_threshold_percent >= 0
      and low_margin_threshold_percent < 100
      and low_margin_threshold_percent <= target_margin_percent
    );
