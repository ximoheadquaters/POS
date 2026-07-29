begin;

create sequence public.supplier_refund_number_seq;

create table public.supplier_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  purchase_return_id uuid not null,
  supplier_payment_id uuid not null,
  refund_number text not null,
  idempotency_key text not null,
  amount numeric(14,2) not null check (amount > 0),
  source public.supplier_payment_source not null,
  register_id uuid,
  shift_id uuid,
  reference text,
  notes text,
  received_at timestamptz not null default now(),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, refund_number),
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  foreign key (purchase_return_id, organization_id)
    references public.purchase_returns(id, organization_id) on delete restrict,
  foreign key (supplier_payment_id, organization_id)
    references public.supplier_payments(id, organization_id) on delete restrict,
  foreign key (register_id, organization_id)
    references public.registers(id, organization_id) on delete restrict,
  foreign key (shift_id, organization_id)
    references public.register_shifts(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  check (
    (source = 'cashier_drawer' and register_id is not null and shift_id is not null)
    or
    (source <> 'cashier_drawer' and register_id is null and shift_id is null)
  )
);

alter table public.cash_movements
  add column supplier_refund_id uuid,
  add constraint cash_movements_supplier_refund_fk
    foreign key (supplier_refund_id, organization_id)
    references public.supplier_refunds(id, organization_id) on delete restrict,
  add constraint cash_movements_supplier_refund_unique unique (supplier_refund_id);

create index supplier_refunds_return_idx
  on public.supplier_refunds(organization_id, purchase_return_id, received_at desc);
create index supplier_refunds_payment_idx
  on public.supplier_refunds(organization_id, supplier_payment_id, received_at desc);

create trigger supplier_refunds_immutable before update or delete on public.supplier_refunds
for each row execute function public.prevent_ledger_mutation();

alter table public.supplier_refunds enable row level security;

create policy tenant_read_supplier_refunds on public.supplier_refunds
for select using (organization_id = public.current_organization_id());

commit;
