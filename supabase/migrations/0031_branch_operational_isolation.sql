begin;

-- Operational data belongs to exactly one branch. Organizations remain the SaaS
-- tenancy and billing boundary, while branches are the catalogue/reporting boundary.
alter table public.products add column if not exists branch_id uuid;
alter table public.product_variants add column if not exists branch_id uuid;
alter table public.product_barcodes add column if not exists branch_id uuid;
alter table public.categories add column if not exists branch_id uuid;
alter table public.brands add column if not exists branch_id uuid;
alter table public.customers add column if not exists branch_id uuid;
alter table public.suppliers add column if not exists branch_id uuid;
alter table public.promotions add column if not exists branch_id uuid;
alter table public.stock_transfer_items add column if not exists destination_product_id uuid;
alter table public.stock_transfer_items add column if not exists destination_container_variant_id uuid;

create temporary table _default_branch on commit drop as
select distinct on (b.organization_id)
  b.organization_id,
  b.id as branch_id
from public.branches b
where b.is_active
order by b.organization_id,
  case when lower(b.name) like '%main%' then 0 else 1 end,
  b.created_at,
  b.id;

-- Build the branches where each legacy product has actual operational evidence.
-- Zero-value branch_inventory rows were historically created for every branch and
-- intentionally do not make a product part of that branch's catalogue.
create temporary table _product_branch_evidence (
  product_id uuid not null,
  branch_id uuid not null,
  score bigint not null,
  primary key (product_id, branch_id)
) on commit drop;

insert into _product_branch_evidence(product_id, branch_id, score)
select evidence.product_id, evidence.branch_id, sum(evidence.score)::bigint
from (
  select bi.product_id, bi.branch_id,
    1000 + least(999, abs(coalesce(bi.quantity, 0))::bigint) as score
  from public.branch_inventory bi
  where coalesce(bi.quantity, 0) <> 0
     or coalesce(bi.sealed_quantity, 0) <> 0
     or coalesce(bi.opened_quantity, 0) <> 0
  union all
  select im.product_id, im.branch_id, 100 + count(*)::bigint
  from public.inventory_movements im group by im.product_id, im.branch_id
  union all
  select si.product_id, s.branch_id, 10000 + count(*)::bigint
  from public.sale_items si join public.sales s on s.id = si.sale_id
  group by si.product_id, s.branch_id
  union all
  select poi.product_id, po.branch_id, 500 + count(*)::bigint
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id = poi.purchase_order_id
  group by poi.product_id, po.branch_id
  union all
  select pb.product_id, pb.branch_id, 500 + count(*)::bigint
  from public.production_batches pb group by pb.product_id, pb.branch_id
  union all
  select sti.product_id, st.from_branch_id, 250 + count(*)::bigint
  from public.stock_transfer_items sti
  join public.stock_transfers st on st.id = sti.stock_transfer_id
  group by sti.product_id, st.from_branch_id
  union all
  select sti.product_id, st.to_branch_id, 250 + count(*)::bigint
  from public.stock_transfer_items sti
  join public.stock_transfers st on st.id = sti.stock_transfer_id
  group by sti.product_id, st.to_branch_id
) evidence
group by evidence.product_id, evidence.branch_id
on conflict (product_id, branch_id) do update set score = excluded.score;

-- A recipe ingredient must exist in the same branch as its finished product.
with recursive required_products(product_id, branch_id) as (
  select product_id, branch_id from _product_branch_evidence
  union
  select pr.ingredient_product_id, required_products.branch_id
  from required_products
  join public.product_recipes pr on pr.parent_product_id = required_products.product_id
)
insert into _product_branch_evidence(product_id, branch_id, score)
select product_id, branch_id, 50
from required_products
on conflict (product_id, branch_id) do nothing;

insert into _product_branch_evidence(product_id, branch_id, score)
select p.id, d.branch_id, 1
from public.products p
join _default_branch d on d.organization_id = p.organization_id
where not exists (
  select 1 from _product_branch_evidence e where e.product_id = p.id
)
on conflict (product_id, branch_id) do nothing;

-- A legacy promotion is assigned to the branch where its component products have
-- the strongest operational evidence. Empty promotions use the default branch.
-- Every component is then made available in that same branch before products are
-- cloned, so a combo can never point across branch catalogues.
create temporary table _promotion_branch on commit drop as
select promo.id as promotion_id,
  coalesce(preferred.branch_id, d.branch_id) as branch_id
from public.promotions promo
join _default_branch d on d.organization_id = promo.organization_id
left join lateral (
  select e.branch_id
  from public.promotion_items pi
  join _product_branch_evidence e on e.product_id = pi.product_id
  where pi.promotion_id = promo.id
  group by e.branch_id
  order by sum(e.score) desc, e.branch_id
  limit 1
) preferred on true;

insert into _product_branch_evidence(product_id, branch_id, score)
select pi.product_id, pb.branch_id, 40
from public.promotion_items pi
join _promotion_branch pb on pb.promotion_id = pi.promotion_id
on conflict (product_id, branch_id) do nothing;

create temporary table _product_map on commit drop as
select ranked.product_id as original_product_id,
  ranked.branch_id,
  case when ranked.branch_rank = 1 then ranked.product_id else gen_random_uuid() end as mapped_product_id,
  ranked.branch_rank = 1 as keeps_original
from (
  select e.*,
    row_number() over (
      partition by e.product_id
      order by e.score desc, b.created_at, e.branch_id
    ) as branch_rank
  from _product_branch_evidence e
  join public.branches b on b.id = e.branch_id
) ranked;

alter table public.products drop constraint if exists products_organization_id_sku_key;
alter table public.product_variants drop constraint if exists product_variants_organization_id_sku_key;
alter table public.product_barcodes drop constraint if exists product_barcodes_organization_id_barcode_key;

-- This migration only rewires immutable ledger references; amounts, quantities,
-- timestamps and financial values are untouched. Re-enable the guards before commit.
alter table public.inventory_movements disable trigger inventory_movements_immutable;
alter table public.purchase_returns disable trigger purchase_returns_immutable;

update public.products p
set branch_id = m.branch_id
from _product_map m
where m.original_product_id = p.id and m.keeps_original;

insert into public.products (
  id, organization_id, branch_id, category_id, brand_id, name, sku, description,
  cost, selling_price, tax_rate, is_tax_inclusive, status, image_path, created_at,
  updated_at, unit, track_inventory, inventory_role, preparation_behavior
)
select m.mapped_product_id, p.organization_id, m.branch_id, p.category_id, p.brand_id,
  p.name, p.sku, p.description, p.cost, p.selling_price, p.tax_rate,
  p.is_tax_inclusive, p.status, p.image_path, p.created_at, p.updated_at, p.unit,
  p.track_inventory, p.inventory_role, p.preparation_behavior
from _product_map m
join public.products p on p.id = m.original_product_id
where not m.keeps_original;

create temporary table _variant_map on commit drop as
select v.id as original_variant_id, m.branch_id,
  case when m.keeps_original then v.id else gen_random_uuid() end as mapped_variant_id,
  m.mapped_product_id,
  m.keeps_original
from public.product_variants v
join _product_map m on m.original_product_id = v.product_id;

update public.product_variants v
set branch_id = m.branch_id
from _variant_map m
where m.original_variant_id = v.id and m.keeps_original;

insert into public.product_variants (
  id, organization_id, branch_id, product_id, name, sku, cost, selling_price,
  is_active, created_at, updated_at, unit, units_per_base, is_portioning_container
)
select m.mapped_variant_id, v.organization_id, m.branch_id, m.mapped_product_id,
  v.name, v.sku, v.cost, v.selling_price, v.is_active, v.created_at, v.updated_at,
  v.unit, v.units_per_base, v.is_portioning_container
from _variant_map m
join public.product_variants v on v.id = m.original_variant_id
where not m.keeps_original;

update public.product_barcodes pb
set branch_id = p.branch_id
from public.products p
where p.id = pb.product_id;

insert into public.product_barcodes (
  organization_id, branch_id, product_id, variant_id, barcode, created_at
)
select pb.organization_id, pm.branch_id, pm.mapped_product_id,
  vm.mapped_variant_id, pb.barcode, pb.created_at
from public.product_barcodes pb
join _product_map pm on pm.original_product_id = pb.product_id and not pm.keeps_original
left join _variant_map vm
  on vm.original_variant_id = pb.variant_id and vm.branch_id = pm.branch_id
on conflict do nothing;

-- Rewire every branch-owned operational reference to its branch-owned product copy.
-- Remove only the legacy zero placeholders that were automatically created for
-- every branch. They have no stock value and no operational evidence.
delete from public.branch_inventory bi
where not exists (
    select 1 from _product_map pm
    where pm.original_product_id = bi.product_id and pm.branch_id = bi.branch_id
  )
  and coalesce(bi.quantity, 0) = 0
  and coalesce(bi.sealed_quantity, 0) = 0
  and coalesce(bi.opened_quantity, 0) = 0;

with mapped as (
  select bi.id, pm.mapped_product_id,
    (select vm.mapped_variant_id from _variant_map vm
      where vm.original_variant_id = bi.variant_id and vm.branch_id = bi.branch_id) as mapped_variant_id
  from public.branch_inventory bi
  join _product_map pm
    on pm.original_product_id = bi.product_id and pm.branch_id = bi.branch_id
)
update public.branch_inventory bi
set product_id = mapped.mapped_product_id,
    variant_id = mapped.mapped_variant_id
from mapped where mapped.id = bi.id;

with mapped as (
  select im.id, pm.mapped_product_id,
    (select vm.mapped_variant_id from _variant_map vm
      where vm.original_variant_id = im.variant_id and vm.branch_id = im.branch_id) as mapped_variant_id
  from public.inventory_movements im
  join _product_map pm
    on pm.original_product_id = im.product_id and pm.branch_id = im.branch_id
)
update public.inventory_movements im
set product_id = mapped.mapped_product_id,
    variant_id = mapped.mapped_variant_id
from mapped where mapped.id = im.id;

with mapped as (
  select ipm.id, pm.mapped_product_id,
    (select vm.mapped_variant_id from _variant_map vm
      where vm.original_variant_id = ipm.container_variant_id and vm.branch_id = ipm.branch_id) as mapped_variant_id
  from public.inventory_pool_movements ipm
  join _product_map pm
    on pm.original_product_id = ipm.product_id and pm.branch_id = ipm.branch_id
)
update public.inventory_pool_movements ipm
set product_id = mapped.mapped_product_id,
    container_variant_id = mapped.mapped_variant_id
from mapped where mapped.id = ipm.id;

with mapped as (
  select si.id, pm.mapped_product_id,
    (select vm.mapped_variant_id from _variant_map vm
      where vm.original_variant_id = si.variant_id and vm.branch_id = s.branch_id) as mapped_variant_id
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  join _product_map pm
    on pm.original_product_id = si.product_id and pm.branch_id = s.branch_id
)
update public.sale_items si
set product_id = mapped.mapped_product_id,
    variant_id = mapped.mapped_variant_id
from mapped where mapped.id = si.id;

with mapped as (
  select poi.id, pm.mapped_product_id,
    (select vm.mapped_variant_id from _variant_map vm
      where vm.original_variant_id = poi.variant_id and vm.branch_id = po.branch_id) as mapped_variant_id
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id = poi.purchase_order_id
  join _product_map pm
    on pm.original_product_id = poi.product_id and pm.branch_id = po.branch_id
)
update public.purchase_order_items poi
set product_id = mapped.mapped_product_id,
    variant_id = mapped.mapped_variant_id
from mapped where mapped.id = poi.id;

update public.production_batches batch
set product_id = pm.mapped_product_id
from _product_map pm
where pm.original_product_id = batch.product_id and pm.branch_id = batch.branch_id;

with mapped as (
  select pbi.id, pm.mapped_product_id
  from public.production_batch_items pbi
  join public.production_batches batch on batch.id = pbi.production_batch_id
  join _product_map pm
    on pm.original_product_id = pbi.ingredient_product_id and pm.branch_id = batch.branch_id
)
update public.production_batch_items pbi
set ingredient_product_id = mapped.mapped_product_id
from mapped where mapped.id = pbi.id;

with mapped as (
  select sti.id,
    source_map.mapped_product_id as source_product_id,
    destination_map.mapped_product_id as destination_product_id,
    (select vm.mapped_variant_id from _variant_map vm
      where vm.original_variant_id = sti.container_variant_id
        and vm.branch_id = st.from_branch_id) as source_container_variant_id,
    (select vm.mapped_variant_id from _variant_map vm
      where vm.original_variant_id = sti.container_variant_id
        and vm.branch_id = st.to_branch_id) as destination_container_variant_id
  from public.stock_transfer_items sti
  join public.stock_transfers st on st.id = sti.stock_transfer_id
  join _product_map source_map
    on source_map.original_product_id = sti.product_id and source_map.branch_id = st.from_branch_id
  join _product_map destination_map
    on destination_map.original_product_id = sti.product_id and destination_map.branch_id = st.to_branch_id
)
update public.stock_transfer_items sti
set product_id = mapped.source_product_id,
    container_variant_id = mapped.source_container_variant_id,
    destination_product_id = mapped.destination_product_id,
    destination_container_variant_id = mapped.destination_container_variant_id
from mapped where mapped.id = sti.id;

-- Clone recipes for cloned finished products, using ingredient records in the same branch.
insert into public.product_recipes (
  organization_id, parent_product_id, parent_variant_id, ingredient_product_id,
  ingredient_variant_id, quantity_required, unit, created_at, updated_at
)
select pr.organization_id, parent_map.mapped_product_id, parent_variant.mapped_variant_id,
  ingredient_map.mapped_product_id, ingredient_variant.mapped_variant_id,
  pr.quantity_required, pr.unit, pr.created_at, pr.updated_at
from public.product_recipes pr
join _product_map parent_map
  on parent_map.original_product_id = pr.parent_product_id and not parent_map.keeps_original
join _product_map ingredient_map
  on ingredient_map.original_product_id = pr.ingredient_product_id
 and ingredient_map.branch_id = parent_map.branch_id
left join _variant_map parent_variant
  on parent_variant.original_variant_id = pr.parent_variant_id
 and parent_variant.branch_id = parent_map.branch_id
left join _variant_map ingredient_variant
  on ingredient_variant.original_variant_id = pr.ingredient_variant_id
 and ingredient_variant.branch_id = parent_map.branch_id
on conflict do nothing;

with mapped as (
  select pr.id, ingredient_map.mapped_product_id,
    (select vm.mapped_variant_id from _variant_map vm
      where vm.original_variant_id = pr.ingredient_variant_id
        and vm.branch_id = parent.branch_id) as mapped_variant_id
  from public.product_recipes pr
  join public.products parent on parent.id = pr.parent_product_id
  join _product_map ingredient_map
    on ingredient_map.original_product_id = pr.ingredient_product_id
   and ingredient_map.branch_id = parent.branch_id
)
update public.product_recipes pr
set ingredient_product_id = mapped.mapped_product_id,
    ingredient_variant_id = mapped.mapped_variant_id
from mapped where mapped.id = pr.id;

-- Branch-own category and brand masters, cloning a label only when products in more
-- than one branch legitimately use it.
create temporary table _category_map on commit drop as
with used as (
  select distinct p.category_id as original_id, p.branch_id
  from public.products p where p.category_id is not null
), ranked as (
  select used.*,
    row_number() over (partition by original_id order by branch_id) as branch_rank
  from used
)
select original_id, branch_id,
  case when branch_rank = 1 then original_id else gen_random_uuid() end as mapped_id
from ranked;

alter table public.categories drop constraint if exists categories_organization_id_name_key;
update public.categories c set branch_id = m.branch_id
from _category_map m where m.original_id = c.id and m.mapped_id = c.id;
insert into public.categories (
  id, organization_id, branch_id, name, description, is_active, created_at, updated_at
)
select m.mapped_id, c.organization_id, m.branch_id, c.name, c.description,
  c.is_active, c.created_at, c.updated_at
from _category_map m join public.categories c on c.id = m.original_id
where m.mapped_id <> m.original_id;
update public.products p set category_id = m.mapped_id
from _category_map m where m.original_id = p.category_id and m.branch_id = p.branch_id;
update public.categories c set branch_id = d.branch_id
from _default_branch d where c.branch_id is null and d.organization_id = c.organization_id;

create temporary table _brand_map on commit drop as
with used as (
  select distinct p.brand_id as original_id, p.branch_id
  from public.products p where p.brand_id is not null
), ranked as (
  select used.*,
    row_number() over (partition by original_id order by branch_id) as branch_rank
  from used
)
select original_id, branch_id,
  case when branch_rank = 1 then original_id else gen_random_uuid() end as mapped_id
from ranked;

alter table public.brands drop constraint if exists brands_organization_id_name_key;
update public.brands b set branch_id = m.branch_id
from _brand_map m where m.original_id = b.id and m.mapped_id = b.id;
insert into public.brands (
  id, organization_id, branch_id, name, description, is_active, created_at, updated_at
)
select m.mapped_id, b.organization_id, m.branch_id, b.name, b.description,
  b.is_active, b.created_at, b.updated_at
from _brand_map m join public.brands b on b.id = m.original_id
where m.mapped_id <> m.original_id;
update public.products p set brand_id = m.mapped_id
from _brand_map m where m.original_id = p.brand_id and m.branch_id = p.branch_id;
update public.brands b set branch_id = d.branch_id
from _default_branch d where b.branch_id is null and d.organization_id = b.organization_id;

-- Customers are copied only when historical sales prove they were used by more than
-- one branch. Each sale is then rewired to the branch-owned customer record.
create temporary table _customer_map on commit drop as
with evidence as (
  select s.customer_id as original_id, s.branch_id, count(*)::bigint as score
  from public.sales s where s.customer_id is not null
  group by s.customer_id, s.branch_id
  union all
  select c.id, d.branch_id, 0
  from public.customers c
  join _default_branch d on d.organization_id = c.organization_id
  where not exists (select 1 from public.sales s where s.customer_id = c.id)
), ranked as (
  select evidence.*,
    row_number() over (partition by original_id order by score desc, branch_id) as branch_rank
  from evidence
)
select original_id, branch_id,
  case when branch_rank = 1 then original_id else gen_random_uuid() end as mapped_id,
  branch_rank = 1 as keeps_original
from ranked;

update public.customers c set branch_id = m.branch_id
from _customer_map m where m.original_id = c.id and m.keeps_original;
insert into public.customers (
  id, organization_id, branch_id, name, email, phone, address, notes,
  is_active, created_at, updated_at
)
select m.mapped_id, c.organization_id, m.branch_id, c.name, c.email, c.phone,
  c.address, c.notes, c.is_active, c.created_at, c.updated_at
from _customer_map m join public.customers c on c.id = m.original_id
where not m.keeps_original;
update public.sales s set customer_id = m.mapped_id
from _customer_map m
where m.original_id = s.customer_id and m.branch_id = s.branch_id;

-- Suppliers follow the same rule across purchase orders, returns and invoices.
create temporary table _supplier_map on commit drop as
with evidence as (
  select po.supplier_id as original_id, po.branch_id, count(*)::bigint as score
  from public.purchase_orders po group by po.supplier_id, po.branch_id
  union all
  select supplier.id, d.branch_id, 0
  from public.suppliers supplier
  join _default_branch d on d.organization_id = supplier.organization_id
  where not exists (select 1 from public.purchase_orders po where po.supplier_id = supplier.id)
), combined as (
  select original_id, branch_id, sum(score)::bigint as score
  from evidence group by original_id, branch_id
), ranked as (
  select combined.*,
    row_number() over (partition by original_id order by score desc, branch_id) as branch_rank
  from combined
)
select original_id, branch_id,
  case when branch_rank = 1 then original_id else gen_random_uuid() end as mapped_id,
  branch_rank = 1 as keeps_original
from ranked;

alter table public.suppliers drop constraint if exists suppliers_organization_id_name_key;
update public.suppliers supplier set branch_id = m.branch_id
from _supplier_map m where m.original_id = supplier.id and m.keeps_original;
insert into public.suppliers (
  id, organization_id, branch_id, name, contact_name, email, phone, address,
  tax_id, notes, is_active, created_at, updated_at
)
select m.mapped_id, supplier.organization_id, m.branch_id, supplier.name,
  supplier.contact_name, supplier.email, supplier.phone, supplier.address,
  supplier.tax_id, supplier.notes, supplier.is_active, supplier.created_at,
  supplier.updated_at
from _supplier_map m join public.suppliers supplier on supplier.id = m.original_id
where not m.keeps_original;
update public.purchase_orders po set supplier_id = m.mapped_id
from _supplier_map m
where m.original_id = po.supplier_id and m.branch_id = po.branch_id;
update public.purchase_returns purchase_return set supplier_id = m.mapped_id
from _supplier_map m
where m.original_id = purchase_return.supplier_id
  and m.branch_id = purchase_return.branch_id;
update public.supplier_invoices invoice set supplier_id = m.mapped_id
from _supplier_map m
where m.original_id = invoice.supplier_id and m.branch_id = invoice.branch_id;

-- Promotions stay in one branch. Their component references are rewired to product
-- records belonging to that same branch, so they cannot leak into another POS.
update public.promotions promo set branch_id = pb.branch_id
from _promotion_branch pb where pb.promotion_id = promo.id;
update public.promotion_items pi set product_id = pm.mapped_product_id
from public.promotions promo, _product_map pm
where promo.id = pi.promotion_id
  and pm.original_product_id = pi.product_id
  and pm.branch_id = promo.branch_id;

alter table public.inventory_movements enable trigger inventory_movements_immutable;
alter table public.purchase_returns enable trigger purchase_returns_immutable;

-- Branch foreign keys and branch-local uniqueness prevent accidental cross-branch use.
alter table public.products alter column branch_id set not null;
alter table public.product_variants alter column branch_id set not null;
alter table public.product_barcodes alter column branch_id set not null;
alter table public.categories alter column branch_id set not null;
alter table public.brands alter column branch_id set not null;
alter table public.customers alter column branch_id set not null;
alter table public.suppliers alter column branch_id set not null;
alter table public.promotions alter column branch_id set not null;

alter table public.products add constraint products_branch_organization_fkey
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict;
alter table public.product_variants add constraint product_variants_branch_organization_fkey
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict;
alter table public.product_barcodes add constraint product_barcodes_branch_organization_fkey
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict;
alter table public.categories add constraint categories_branch_organization_fkey
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict;
alter table public.brands add constraint brands_branch_organization_fkey
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict;
alter table public.customers add constraint customers_branch_organization_fkey
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict;
alter table public.suppliers add constraint suppliers_branch_organization_fkey
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict;
alter table public.promotions add constraint promotions_branch_organization_fkey
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict;
alter table public.stock_transfer_items add constraint stock_transfer_items_destination_product_fkey
  foreign key (destination_product_id) references public.products(id) on delete restrict;
alter table public.stock_transfer_items add constraint stock_transfer_items_destination_container_variant_fkey
  foreign key (destination_container_variant_id) references public.product_variants(id) on delete restrict;

alter table public.products add constraint products_organization_branch_sku_key
  unique (organization_id, branch_id, sku);
alter table public.product_variants add constraint product_variants_organization_branch_sku_key
  unique (organization_id, branch_id, sku);
alter table public.product_barcodes add constraint product_barcodes_organization_branch_barcode_key
  unique (organization_id, branch_id, barcode);
alter table public.categories add constraint categories_organization_branch_name_key
  unique (organization_id, branch_id, name);
alter table public.brands add constraint brands_organization_branch_name_key
  unique (organization_id, branch_id, name);
alter table public.suppliers add constraint suppliers_organization_branch_name_key
  unique (organization_id, branch_id, name);

create index products_branch_catalog_idx
  on public.products(organization_id, branch_id, status, lower(name));
create index promotions_branch_catalog_idx
  on public.promotions(organization_id, branch_id, is_active, type);
create index customers_branch_catalog_idx
  on public.customers(organization_id, branch_id, is_active, lower(name));
create index suppliers_branch_catalog_idx
  on public.suppliers(organization_id, branch_id, is_active, lower(name));

-- Authenticated Supabase clients may read only branches they are assigned to.
-- Owners and administrators continue to pass can_access_branch for every branch.
drop policy if exists tenant_read_categories on public.categories;
create policy tenant_read_categories on public.categories for select
  using (organization_id = public.current_organization_id() and public.can_access_branch(branch_id));
drop policy if exists tenant_read_brands on public.brands;
create policy tenant_read_brands on public.brands for select
  using (organization_id = public.current_organization_id() and public.can_access_branch(branch_id));
drop policy if exists tenant_read_products on public.products;
create policy tenant_read_products on public.products for select
  using (organization_id = public.current_organization_id() and public.can_access_branch(branch_id));
drop policy if exists tenant_read_product_variants on public.product_variants;
create policy tenant_read_product_variants on public.product_variants for select
  using (organization_id = public.current_organization_id() and public.can_access_branch(branch_id));
drop policy if exists tenant_read_product_barcodes on public.product_barcodes;
create policy tenant_read_product_barcodes on public.product_barcodes for select
  using (organization_id = public.current_organization_id() and public.can_access_branch(branch_id));
drop policy if exists tenant_read_customers on public.customers;
create policy tenant_read_customers on public.customers for select
  using (organization_id = public.current_organization_id() and public.can_access_branch(branch_id));
drop policy if exists tenant_read_suppliers on public.suppliers;
create policy tenant_read_suppliers on public.suppliers for select
  using (organization_id = public.current_organization_id() and public.can_access_branch(branch_id));
drop policy if exists tenant_read_promotions on public.promotions;
create policy tenant_read_promotions on public.promotions for select
  using (organization_id = public.current_organization_id() and public.can_access_branch(branch_id));
drop policy if exists tenant_read_promotion_items on public.promotion_items;
create policy tenant_read_promotion_items on public.promotion_items for select
  using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.promotions promo
      where promo.id = public.promotion_items.promotion_id
        and public.can_access_branch(promo.branch_id)
    )
  );

commit;
