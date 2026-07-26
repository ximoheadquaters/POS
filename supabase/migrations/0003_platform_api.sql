begin;

create table public.platform_api_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  token_prefix text not null unique check (char_length(token_prefix) between 8 and 32),
  token_hash char(64) not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null default array['platform:read', 'platform:write'],
  is_active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    cardinality(scopes) > 0
    and scopes <@ array['platform:read', 'platform:write']::text[]
  )
);

create table public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  api_client_id uuid not null references public.platform_api_clients(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index platform_api_clients_active_hash_idx
  on public.platform_api_clients(token_hash)
  where is_active;

create index platform_audit_history_idx
  on public.platform_audit_logs(created_at desc);

create index platform_audit_organization_idx
  on public.platform_audit_logs(organization_id, created_at desc);

create trigger platform_api_clients_set_updated_at
before update on public.platform_api_clients
for each row execute function public.set_updated_at();

create trigger platform_audit_logs_immutable
before update or delete on public.platform_audit_logs
for each row execute function public.prevent_ledger_mutation();

alter table public.platform_api_clients enable row level security;
alter table public.platform_audit_logs enable row level security;

comment on table public.platform_api_clients is
  'Server-to-server clients authorized to call the Ximo Platform API. Raw tokens are never stored.';

comment on table public.platform_audit_logs is
  'Immutable audit history for platform-level subscription and module changes.';

commit;
