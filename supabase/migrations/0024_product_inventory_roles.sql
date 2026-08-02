alter table public.products
  add column if not exists inventory_role text not null default 'sellable';

alter table public.products
  drop constraint if exists products_inventory_role_check;

alter table public.products
  add constraint products_inventory_role_check
  check (inventory_role in ('sellable', 'ingredient', 'both'));

-- Preserve existing recipes: their referenced products must remain selectable as ingredients.
update public.products p
set inventory_role = 'both'
where exists (
  select 1
  from public.product_recipes pr
  where pr.organization_id = p.organization_id
    and pr.ingredient_product_id = p.id
);

create index if not exists products_organization_inventory_role_idx
  on public.products (organization_id, inventory_role, status);
