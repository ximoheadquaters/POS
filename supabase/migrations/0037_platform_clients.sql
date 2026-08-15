begin;

-- Platform client directory
--
-- A client is Ximo's commercial/customer record. It is intentionally separate
-- from a POS organization: one client may be assigned to Ximo POS today and to
-- other Ximo applications later. Operational data continues to live behind the
-- tenant created by each application.

-- Keep this migration safe for installations where the multi-product platform
-- migration has not yet been committed to the migration history.
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,79}$'),
  name text not null check (char_length(name) between 2 and 120),
  description text,
  launch_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.applications (code, name, description)
values (
  'ximo_pos',
  'Ximo POS',
  'Point of sale, catalogue, purchasing, inventory, branch operations and reporting.'
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'company'
    check (kind in ('company', 'individual')),
  status text not null default 'prospect'
    check (status in ('prospect', 'active', 'inactive', 'archived')),
  legal_name text not null check (char_length(btrim(legal_name)) between 2 and 200),
  display_name text,
  primary_email text,
  primary_phone text,
  industry text,
  preferred_currency text not null default 'PHP'
    check (preferred_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Manila',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_type text not null default 'general'
    check (contact_type in ('owner', 'general', 'billing', 'technical', 'legal')),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  job_title text,
  email text,
  phone text,
  is_primary boolean not null default false,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_addresses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  address_type text not null default 'business'
    check (address_type in ('business', 'billing', 'shipping', 'registered')),
  line_1 text not null,
  line_2 text,
  city text,
  province text,
  postal_code text,
  country_code text not null default 'PH'
    check (country_code ~ '^[A-Z]{2}$'),
  is_primary boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_systems (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- The legacy column name is retained for API compatibility, but its value is
  -- the canonical application code from public.applications (for example,
  -- ximo_pos). There is no second systems catalogue.
  system_code text not null references public.applications(code) on delete restrict,
  external_tenant_id text not null,
  status text not null default 'active'
    check (status in ('pending', 'active', 'suspended', 'cancelled')),
  activated_at timestamptz,
  deactivated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, system_code)
);

create index if not exists clients_status_created_idx
  on public.clients(status, created_at desc);
create index if not exists clients_name_idx
  on public.clients(lower(legal_name));
create index if not exists client_contacts_client_idx
  on public.client_contacts(client_id, is_primary desc);
create index if not exists client_addresses_client_idx
  on public.client_addresses(client_id, is_primary desc);
create index if not exists client_systems_application_idx
  on public.client_systems(system_code, status, activated_at desc);

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
before update on public.applications
for each row execute function public.set_updated_at();

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists client_contacts_set_updated_at on public.client_contacts;
create trigger client_contacts_set_updated_at
before update on public.client_contacts
for each row execute function public.set_updated_at();

drop trigger if exists client_addresses_set_updated_at on public.client_addresses;
create trigger client_addresses_set_updated_at
before update on public.client_addresses
for each row execute function public.set_updated_at();

drop trigger if exists client_systems_set_updated_at on public.client_systems;
create trigger client_systems_set_updated_at
before update on public.client_systems
for each row execute function public.set_updated_at();

-- These SECURITY DEFINER helpers prevent recursive policy evaluation on
-- platform_admins and keep platform data unavailable to tenant-only accounts.
create or replace function public.is_active_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins administrator
    where administrator.id = auth.uid()
      and administrator.is_active
  )
$$;

create or replace function public.is_platform_admin_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins administrator
    where administrator.id = auth.uid()
      and administrator.is_active
      and administrator.role in ('admin', 'super_admin')
  )
$$;

revoke all on function public.is_active_platform_admin() from public, anon;
revoke all on function public.is_platform_admin_writer() from public, anon;
grant execute on function public.is_active_platform_admin() to authenticated, service_role;
grant execute on function public.is_platform_admin_writer() to authenticated, service_role;

alter table public.applications enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.client_addresses enable row level security;
alter table public.client_systems enable row level security;

drop policy if exists platform_admin_read_clients on public.clients;
create policy platform_admin_read_clients on public.clients for select
  to authenticated using (public.is_active_platform_admin());
drop policy if exists platform_admin_write_clients on public.clients;
create policy platform_admin_write_clients on public.clients for all
  to authenticated
  using (public.is_platform_admin_writer())
  with check (public.is_platform_admin_writer());

drop policy if exists platform_admin_read_client_contacts on public.client_contacts;
create policy platform_admin_read_client_contacts on public.client_contacts for select
  to authenticated using (public.is_active_platform_admin());
drop policy if exists platform_admin_write_client_contacts on public.client_contacts;
create policy platform_admin_write_client_contacts on public.client_contacts for all
  to authenticated
  using (public.is_platform_admin_writer())
  with check (public.is_platform_admin_writer());

drop policy if exists platform_admin_read_client_addresses on public.client_addresses;
create policy platform_admin_read_client_addresses on public.client_addresses for select
  to authenticated using (public.is_active_platform_admin());
drop policy if exists platform_admin_write_client_addresses on public.client_addresses;
create policy platform_admin_write_client_addresses on public.client_addresses for all
  to authenticated
  using (public.is_platform_admin_writer())
  with check (public.is_platform_admin_writer());

drop policy if exists platform_admin_read_client_systems on public.client_systems;
create policy platform_admin_read_client_systems on public.client_systems for select
  to authenticated using (public.is_active_platform_admin());
drop policy if exists platform_admin_write_client_systems on public.client_systems;
create policy platform_admin_write_client_systems on public.client_systems for all
  to authenticated
  using (public.is_platform_admin_writer())
  with check (public.is_platform_admin_writer());

-- Applications are a public-to-signed-in product catalogue. Writes remain
-- server-side; platform admins manage customer assignments, not registry rows.
drop policy if exists applications_authenticated_read on public.applications;
create policy applications_authenticated_read on public.applications for select
  to authenticated using (is_active);

revoke all on table public.clients from anon;
revoke all on table public.client_contacts from anon;
revoke all on table public.client_addresses from anon;
revoke all on table public.client_systems from anon;
grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete on table public.client_contacts to authenticated;
grant select, insert, update, delete on table public.client_addresses to authenticated;
grant select, insert, update, delete on table public.client_systems to authenticated;
grant select on table public.applications to authenticated;

comment on table public.clients is
  'Ximo-wide commercial client records. Product-specific tenants are linked through client_systems.';
comment on table public.client_systems is
  'Assignments from a Ximo client to a canonical public.applications entry and its external tenant.';

-- Ask PostgREST to refresh its relationship and table cache immediately.
notify pgrst, 'reload schema';

commit;
