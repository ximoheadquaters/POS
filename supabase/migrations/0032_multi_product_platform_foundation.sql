begin;

-- Ximo platform foundation
--
-- Supabase Auth remains the global identity provider. Organizations remain the
-- customer/data boundary. Applications describe the Ximo products an organization
-- can subscribe to (POS today; e-commerce, payroll, etc. later).

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

create or replace function public.ximo_pos_application_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.applications where code = 'ximo_pos'
$$;

-- Existing plans and modules are POS records. Keeping their existing globally unique
-- codes avoids breaking deployed clients; new Ximo products should use namespaced
-- codes (for example, ecommerce_starter) until the later catalogue split migration.
alter table public.plans add column if not exists application_id uuid;
alter table public.modules add column if not exists application_id uuid;
alter table public.plans alter column application_id
  set default public.ximo_pos_application_id();
alter table public.modules alter column application_id
  set default public.ximo_pos_application_id();

update public.plans
set application_id = (select id from public.applications where code = 'ximo_pos')
where application_id is null;

update public.modules
set application_id = (select id from public.applications where code = 'ximo_pos')
where application_id is null;

alter table public.plans alter column application_id set not null;
alter table public.modules alter column application_id set not null;

alter table public.plans drop constraint if exists plans_application_id_fkey;
alter table public.plans add constraint plans_application_id_fkey
  foreign key (application_id) references public.applications(id) on delete restrict;

alter table public.modules drop constraint if exists modules_application_id_fkey;
alter table public.modules add constraint modules_application_id_fkey
  foreign key (application_id) references public.applications(id) on delete restrict;

create index if not exists plans_application_active_idx
  on public.plans(application_id, is_active, price_monthly);
create index if not exists modules_application_idx
  on public.modules(application_id, code);

-- One organization may now have one subscription per Ximo application instead of
-- one subscription for the entire Ximo platform.
alter table public.subscriptions add column if not exists application_id uuid;
alter table public.subscriptions alter column application_id
  set default public.ximo_pos_application_id();

update public.subscriptions subscription
set application_id = plan.application_id
from public.plans plan
where plan.id = subscription.plan_id and subscription.application_id is null;

alter table public.subscriptions alter column application_id set not null;
alter table public.subscriptions drop constraint if exists subscriptions_application_id_fkey;
alter table public.subscriptions add constraint subscriptions_application_id_fkey
  foreign key (application_id) references public.applications(id) on delete restrict;

drop index if exists public.subscriptions_one_active_per_org_idx;
alter table public.subscriptions drop constraint if exists subscriptions_organization_id_key;
alter table public.subscriptions drop constraint if exists subscriptions_organization_application_key;
alter table public.subscriptions add constraint subscriptions_organization_application_key
  unique (organization_id, application_id);

create unique index if not exists subscriptions_one_active_per_org_application_idx
  on public.subscriptions(organization_id, application_id)
  where status in ('trialing', 'active');

create or replace function public.set_subscription_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_application_id uuid;
begin
  select application_id into selected_application_id
  from public.plans where id = new.plan_id;

  if selected_application_id is null then
    raise exception 'Subscription plan % does not belong to an application', new.plan_id;
  end if;
  if new.application_id is null then
    new.application_id := selected_application_id;
  elsif new.application_id <> selected_application_id then
    raise exception 'Subscription application must match its plan application';
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_set_application on public.subscriptions;
create trigger subscriptions_set_application
before insert or update of plan_id, application_id on public.subscriptions
for each row execute function public.set_subscription_application();

-- A global Auth user can belong to multiple organizations without duplicating the
-- account. The existing profiles table remains as the POS compatibility projection.
create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'removed')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, email)
);

create table if not exists public.membership_application_roles (
  membership_id uuid not null references public.organization_memberships(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (membership_id, application_id)
);

create index if not exists organization_memberships_user_idx
  on public.organization_memberships(user_id, status);
create index if not exists membership_application_roles_application_idx
  on public.membership_application_roles(application_id, role_id);

create or replace function public.validate_membership_application_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_organization_id uuid;
  role_organization_id uuid;
begin
  select organization_id into membership_organization_id
  from public.organization_memberships where id = new.membership_id;
  select organization_id into role_organization_id
  from public.roles where id = new.role_id;
  if membership_organization_id is null or role_organization_id is null
     or membership_organization_id <> role_organization_id then
    raise exception 'Application role must belong to the membership organization';
  end if;
  return new;
end;
$$;

drop trigger if exists membership_application_roles_validate
  on public.membership_application_roles;
create trigger membership_application_roles_validate
before insert or update of membership_id, role_id
on public.membership_application_roles
for each row execute function public.validate_membership_application_role();

insert into public.organization_memberships (
  organization_id, user_id, display_name, email, status, joined_at, created_at, updated_at
)
select profile.organization_id, profile.id, profile.display_name, profile.email,
  case when profile.is_active then 'active' else 'suspended' end,
  profile.created_at, profile.created_at, profile.updated_at
from public.profiles profile
on conflict (organization_id, user_id) do update set
  display_name = excluded.display_name,
  email = excluded.email,
  status = excluded.status,
  updated_at = excluded.updated_at;

insert into public.membership_application_roles (membership_id, application_id, role_id)
select membership.id, application.id, profile.role_id
from public.organization_memberships membership
join public.profiles profile
  on profile.organization_id = membership.organization_id and profile.id = membership.user_id
cross join public.applications application
where application.code = 'ximo_pos'
on conflict (membership_id, application_id) do update set
  role_id = excluded.role_id,
  updated_at = now();

-- Keep the compatibility profile and the platform membership synchronized while POS
-- still writes profiles directly. Future applications write memberships directly.
create or replace function public.sync_profile_platform_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_id_value uuid;
  pos_application_id uuid;
begin
  insert into public.organization_memberships (
    organization_id, user_id, display_name, email, status, joined_at
  ) values (
    new.organization_id, new.id, new.display_name, new.email,
    case when new.is_active then 'active' else 'suspended' end, now()
  )
  on conflict (organization_id, user_id) do update set
    display_name = excluded.display_name,
    email = excluded.email,
    status = excluded.status,
    updated_at = now()
  returning id into membership_id_value;

  select id into pos_application_id from public.applications where code = 'ximo_pos';
  insert into public.membership_application_roles (membership_id, application_id, role_id)
  values (membership_id_value, pos_application_id, new.role_id)
  on conflict (membership_id, application_id) do update set
    role_id = excluded.role_id,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_sync_platform_membership on public.profiles;
create trigger profiles_sync_platform_membership
after insert or update of organization_id, role_id, display_name, email, is_active
on public.profiles
for each row execute function public.sync_profile_platform_membership();

-- Fine-grained application capabilities. Modules are backfilled as boolean
-- entitlements so the website can present one normalized access model.
create table if not exists public.application_entitlements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  name text not null,
  description text,
  value_type text not null default 'boolean'
    check (value_type in ('boolean', 'integer', 'decimal', 'text', 'json')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, code)
);

create table if not exists public.plan_entitlements (
  plan_id uuid not null references public.plans(id) on delete cascade,
  entitlement_id uuid not null references public.application_entitlements(id) on delete cascade,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, entitlement_id)
);

create table if not exists public.organization_entitlement_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  entitlement_id uuid not null references public.application_entitlements(id) on delete cascade,
  value jsonb not null,
  reason text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, application_id, entitlement_id)
);

insert into public.application_entitlements (
  application_id, code, name, description, value_type
)
select module.application_id, 'module.' || module.code, module.name,
  module.description, 'boolean'
from public.modules module
on conflict (application_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

insert into public.plan_entitlements (plan_id, entitlement_id, value)
select plan_module.plan_id, entitlement.id, 'true'::jsonb
from public.plan_modules plan_module
join public.modules module on module.id = plan_module.module_id
join public.application_entitlements entitlement
  on entitlement.application_id = module.application_id
 and entitlement.code = 'module.' || module.code
on conflict (plan_id, entitlement_id) do update set
  value = excluded.value,
  updated_at = now();

-- Read model used by the official website and future Ximo applications.
create or replace view public.organization_application_access
with (security_invoker = true) as
select organization.id as organization_id,
  application.id as application_id,
  application.code as application_code,
  application.name as application_name,
  subscription.id as subscription_id,
  subscription.status::text as subscription_status,
  plan.id as plan_id,
  plan.code as plan_code,
  plan.name as plan_name,
  subscription.trial_ends_at,
  subscription.current_period_ends_at
from public.organizations organization
cross join public.applications application
left join public.subscriptions subscription
  on subscription.organization_id = organization.id
 and subscription.application_id = application.id
left join public.plans plan on plan.id = subscription.plan_id;

alter table public.applications enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.membership_application_roles enable row level security;
alter table public.application_entitlements enable row level security;
alter table public.plan_entitlements enable row level security;
alter table public.organization_entitlement_overrides enable row level security;

drop policy if exists applications_authenticated_read on public.applications;
create policy applications_authenticated_read on public.applications for select
  to authenticated using (is_active);

drop policy if exists memberships_read_own on public.organization_memberships;
create policy memberships_read_own on public.organization_memberships for select
  to authenticated using (user_id = auth.uid());

drop policy if exists membership_roles_read_own on public.membership_application_roles;
create policy membership_roles_read_own on public.membership_application_roles for select
  to authenticated using (exists (
    select 1 from public.organization_memberships membership
    where membership.id = membership_application_roles.membership_id
      and membership.user_id = auth.uid()
  ));

drop policy if exists application_entitlements_authenticated_read on public.application_entitlements;
create policy application_entitlements_authenticated_read on public.application_entitlements
  for select to authenticated using (true);

drop policy if exists plan_entitlements_authenticated_read on public.plan_entitlements;
create policy plan_entitlements_authenticated_read on public.plan_entitlements
  for select to authenticated using (true);

drop policy if exists organization_entitlement_overrides_tenant_read
  on public.organization_entitlement_overrides;
create policy organization_entitlement_overrides_tenant_read
  on public.organization_entitlement_overrides for select to authenticated
  using (organization_id = public.current_organization_id());

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at before update on public.applications
for each row execute function public.set_updated_at();
drop trigger if exists organization_memberships_set_updated_at on public.organization_memberships;
create trigger organization_memberships_set_updated_at before update on public.organization_memberships
for each row execute function public.set_updated_at();
drop trigger if exists membership_application_roles_set_updated_at on public.membership_application_roles;
create trigger membership_application_roles_set_updated_at before update on public.membership_application_roles
for each row execute function public.set_updated_at();
drop trigger if exists application_entitlements_set_updated_at on public.application_entitlements;
create trigger application_entitlements_set_updated_at before update on public.application_entitlements
for each row execute function public.set_updated_at();
drop trigger if exists plan_entitlements_set_updated_at on public.plan_entitlements;
create trigger plan_entitlements_set_updated_at before update on public.plan_entitlements
for each row execute function public.set_updated_at();
drop trigger if exists organization_entitlement_overrides_set_updated_at
  on public.organization_entitlement_overrides;
create trigger organization_entitlement_overrides_set_updated_at
before update on public.organization_entitlement_overrides
for each row execute function public.set_updated_at();

comment on table public.applications is
  'Registry of products in the Ximo platform, such as Ximo POS or future e-commerce applications.';
comment on table public.organization_memberships is
  'Connects one global Supabase Auth identity to one or more customer organizations.';
comment on table public.membership_application_roles is
  'Application-specific role assignment for an organization membership.';
comment on table public.application_entitlements is
  'Application capability catalogue used by plans and organization overrides.';

commit;
