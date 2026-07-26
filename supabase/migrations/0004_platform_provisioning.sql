begin;

alter table public.plans
  add column description text,
  add column billing_interval text not null default 'monthly'
    check (billing_interval in ('monthly', 'yearly')),
  add column is_available_for_onboarding boolean not null default true,
  add column allowed_onboarding_statuses public.subscription_status[] not null
    default array['trialing', 'active']::public.subscription_status[];

alter table public.plans
  add constraint plans_onboarding_statuses_not_empty
  check (cardinality(allowed_onboarding_statuses) > 0);

update public.plans
set description = name || ' plan'
where description is null;

create table public.platform_idempotency_keys (
  api_client_id uuid not null references public.platform_api_clients(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash char(64) not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response_data jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (api_client_id, idempotency_key),
  check (
    (response_data is null and completed_at is null)
    or (response_data is not null and completed_at is not null)
  )
);

create index platform_idempotency_created_idx
  on public.platform_idempotency_keys(created_at);

alter table public.platform_idempotency_keys enable row level security;

comment on table public.platform_idempotency_keys is
  'Atomic replay protection for Platform API mutations. Entries contain request hashes and successful response bodies.';

commit;
