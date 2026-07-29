begin;

create type public.supplier_invoice_status as enum (
  'unpaid',
  'partially_paid',
  'paid',
  'disputed',
  'credited',
  'void'
);

create type public.supplier_payment_source as enum (
  'cashier_drawer',
  'owner_cash',
  'bank_transfer',
  'ewallet',
  'cheque'
);

create sequence public.supplier_payment_number_seq;

create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  supplier_id uuid not null,
  purchase_order_id uuid not null,
  stock_receipt_id uuid,
  invoice_number text not null,
  invoice_date date not null default current_date,
  due_date date,
  total numeric(14,2) not null check (total > 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  status public.supplier_invoice_status not null default 'unpaid',
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, supplier_id, invoice_number),
  unique (id, organization_id),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  foreign key (supplier_id, organization_id)
    references public.suppliers(id, organization_id) on delete restrict,
  foreign key (purchase_order_id, organization_id)
    references public.purchase_orders(id, organization_id) on delete restrict,
  foreign key (stock_receipt_id, organization_id)
    references public.stock_receipts(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  check (paid_amount <= total)
);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  supplier_invoice_id uuid not null,
  payment_number text not null,
  idempotency_key text not null,
  amount numeric(14,2) not null check (amount > 0),
  source public.supplier_payment_source not null,
  register_id uuid,
  shift_id uuid,
  reference text,
  notes text,
  paid_at timestamptz not null default now(),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, payment_number),
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  foreign key (supplier_invoice_id, organization_id)
    references public.supplier_invoices(id, organization_id) on delete restrict,
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
  add column supplier_payment_id uuid,
  add constraint cash_movements_supplier_payment_fk
    foreign key (supplier_payment_id, organization_id)
    references public.supplier_payments(id, organization_id) on delete restrict,
  add constraint cash_movements_supplier_payment_unique unique (supplier_payment_id);

create index supplier_invoices_order_idx
  on public.supplier_invoices(organization_id, purchase_order_id, created_at desc);
create index supplier_invoices_due_idx
  on public.supplier_invoices(organization_id, branch_id, status, due_date);
create index supplier_payments_invoice_idx
  on public.supplier_payments(organization_id, supplier_invoice_id, paid_at desc);

create trigger supplier_invoices_set_updated_at before update on public.supplier_invoices
for each row execute function public.set_updated_at();

create trigger supplier_payments_immutable before update or delete on public.supplier_payments
for each row execute function public.prevent_ledger_mutation();

alter table public.supplier_invoices enable row level security;
alter table public.supplier_payments enable row level security;

create policy tenant_read_supplier_invoices on public.supplier_invoices
for select using (organization_id = public.current_organization_id());

create policy tenant_read_supplier_payments on public.supplier_payments
for select using (organization_id = public.current_organization_id());

insert into public.permissions (code,description) values
  ('purchasing:pay','Record supplier invoices and payments')
on conflict (code) do update set description=excluded.description;

insert into public.role_permissions (role_id,permission_id)
select r.id,p.id
from public.roles r cross join public.permissions p
where p.code='purchasing:pay'
  and r.code in ('owner','administrator','manager')
on conflict do nothing;

commit;
