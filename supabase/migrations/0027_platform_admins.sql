begin;

-- 1. Create platform_admins table for platform-level administrative users
create table if not exists public.platform_admins (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique,
  display_name text not null,
  role text not null default 'viewer'
    check (role in ('viewer', 'admin', 'super_admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_admins_active_idx
  on public.platform_admins(id) where is_active;

alter table public.platform_admins enable row level security;

comment on table public.platform_admins is
  'Ximo platform administrators. Authenticated via Supabase JWT and verified against auth.users.';

-- 2. Modify platform_audit_logs to allow platform admin actors alongside API clients
alter table public.platform_audit_logs
  add column if not exists admin_id uuid references public.platform_admins(id);

alter table public.platform_audit_logs
  alter column api_client_id drop not null;

-- 3. Add constraint using NOT VALID to safely preserve legacy audit rows.
-- POST-MIGRATION CLEANUP PROCEDURE:
--   1. If legacy rows exist with null api_client_id AND null admin_id, resolve their actor identity
--      (e.g., assign to an existing platform_api_client or platform_admin record).
--   2. Once all rows comply, execute:
--      alter table public.platform_audit_logs validate constraint platform_audit_logs_actor_check;
alter table public.platform_audit_logs
  drop constraint if exists platform_audit_logs_actor_check;

alter table public.platform_audit_logs
  add constraint platform_audit_logs_actor_check
  check (api_client_id is not null or admin_id is not null) not valid;

commit;
