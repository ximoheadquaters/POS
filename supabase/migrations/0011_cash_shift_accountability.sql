begin;

alter table public.register_shifts
  add column if not exists cash_refunds numeric(14,2) not null default 0
  check (cash_refunds >= 0);

alter table public.returns
  add column if not exists register_id uuid,
  add column if not exists shift_id uuid;

update public.returns r
set register_id=s.register_id, shift_id=s.shift_id
from public.sales s
where s.id=r.sale_id
  and (r.register_id is null or r.shift_id is null);

alter table public.returns
  alter column register_id set not null,
  alter column shift_id set not null;

alter table public.returns
  drop constraint if exists returns_register_organization_fkey,
  drop constraint if exists returns_shift_organization_fkey;

alter table public.returns
  add constraint returns_register_organization_fkey
    foreign key (register_id, organization_id)
    references public.registers(id, organization_id) on delete restrict,
  add constraint returns_shift_organization_fkey
    foreign key (shift_id, organization_id)
    references public.register_shifts(id, organization_id) on delete restrict;

update public.register_shifts rs
set cash_refunds=coalesce((
  select sum(r.refund_total)
  from public.returns r
  where r.shift_id=rs.id and r.refund_method='cash'
),0);

create index if not exists returns_shift_idx
  on public.returns(organization_id, shift_id, created_at);

commit;
