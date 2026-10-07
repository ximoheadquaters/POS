begin;

-- A website account and a commercial client are related but not identical:
-- a person may register before they confirm their email, choose a plan, or
-- activate a Ximo system. Keep that relationship explicit so platform admins
-- can see and follow up with all website registrations without exposing
-- auth.users to the browser.
create table if not exists public.client_auth_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id uuid not null unique references public.clients(id) on delete cascade,
  email text not null,
  email_confirmed_at timestamptz,
  source text not null default 'website_signup'
    check (source in ('website_signup', 'linked_existing_client')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_auth_accounts_client_idx
  on public.client_auth_accounts(client_id);
create index if not exists client_auth_accounts_unverified_idx
  on public.client_auth_accounts(email_confirmed_at)
  where email_confirmed_at is null;

drop trigger if exists client_auth_accounts_set_updated_at on public.client_auth_accounts;
create trigger client_auth_accounts_set_updated_at
before update on public.client_auth_accounts
for each row execute function public.set_updated_at();

-- Only accounts created by the public Ximo website carry this marker. POS
-- employee invites and platform-admin accounts therefore never become client
-- prospects merely because they share the same Supabase project.
create or replace function public.sync_website_signup_client()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  linked_client_id uuid;
  account_name text;
begin
  -- Once an account has been linked, keep its confirmation state current even
  -- if its metadata is later changed by an administrator.
  select client_id
    into linked_client_id
    from public.client_auth_accounts
   where user_id = new.id;

  if linked_client_id is null
     and coalesce(new.raw_user_meta_data ->> 'ximo_account_type', '') <> 'website_client' then
    return new;
  end if;

  if linked_client_id is null then
    select client.id
      into linked_client_id
      from public.clients client
     where lower(client.primary_email) = lower(new.email)
     order by client.created_at asc
     limit 1
     for update;

    if linked_client_id is null then
      account_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
      if char_length(coalesce(account_name, '')) < 2 then
        account_name := nullif(btrim(split_part(new.email, '@', 1)), '');
      end if;
      if char_length(coalesce(account_name, '')) < 2 then
        account_name := 'Ximo client';
      end if;

      insert into public.clients (
        kind,
        status,
        legal_name,
        display_name,
        primary_email,
        metadata,
        created_by,
        updated_by
      )
      values (
        'individual',
        'prospect',
        left(account_name, 200),
        left(account_name, 200),
        lower(new.email),
        jsonb_build_object(
          'source', 'website_signup',
          'subscription_state', 'not_subscribed'
        ),
        new.id,
        new.id
      )
      returning id into linked_client_id;
    end if;
  end if;

  insert into public.client_auth_accounts (
    user_id,
    client_id,
    email,
    email_confirmed_at,
    source
  )
  values (
    new.id,
    linked_client_id,
    lower(new.email),
    new.email_confirmed_at,
    'website_signup'
  )
  on conflict (user_id) do update
    set client_id = excluded.client_id,
        email = excluded.email,
        email_confirmed_at = excluded.email_confirmed_at,
        source = excluded.source,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_website_signup_client_on_auth_user on auth.users;
create trigger sync_website_signup_client_on_auth_user
after insert or update of email, email_confirmed_at, raw_user_meta_data on auth.users
for each row execute function public.sync_website_signup_client();

-- Backfill public website accounts that predate the marker. Accounts already
-- attached to a POS profile or a platform-admin record are excluded: those are
-- staff/admin identities, not new website customer registrations. Existing
-- paid clients are preserved because a matching client email is never copied.
insert into public.clients (
  kind,
  status,
  legal_name,
  display_name,
  primary_email,
  metadata,
  created_by,
  updated_by
)
select
  'individual',
  'prospect',
  left(
    case
      when char_length(btrim(coalesce(account.raw_user_meta_data ->> 'display_name', ''))) >= 2
        then btrim(account.raw_user_meta_data ->> 'display_name')
      when char_length(btrim(split_part(account.email, '@', 1))) >= 2
        then btrim(split_part(account.email, '@', 1))
      else 'Ximo client'
    end,
    200
  ),
  left(
    case
      when char_length(btrim(coalesce(account.raw_user_meta_data ->> 'display_name', ''))) >= 2
        then btrim(account.raw_user_meta_data ->> 'display_name')
      when char_length(btrim(split_part(account.email, '@', 1))) >= 2
        then btrim(split_part(account.email, '@', 1))
      else 'Ximo client'
    end,
    200
  ),
  lower(account.email),
  jsonb_build_object(
    'source', 'website_signup_backfill',
    'subscription_state', 'not_subscribed'
  ),
  account.id,
  account.id
from auth.users account
left join public.profiles profile on profile.id = account.id
left join public.platform_admins administrator on administrator.id = account.id
left join public.clients existing_client
  on lower(existing_client.primary_email) = lower(account.email)
where account.email is not null
  and btrim(account.email) <> ''
  and profile.id is null
  and administrator.id is null
  and existing_client.id is null;

-- Link every existing client record to its matching authenticated account.
-- This also gives admins confirmation status for customers who subscribed
-- before the client-auth mapping was introduced.
insert into public.client_auth_accounts (
  user_id,
  client_id,
  email,
  email_confirmed_at,
  source
)
select
  account.id,
  matching_client.id,
  lower(account.email),
  account.email_confirmed_at,
  case
    when coalesce(account.raw_user_meta_data ->> 'ximo_account_type', '') = 'website_client'
      then 'website_signup'
    else 'linked_existing_client'
  end
from auth.users account
cross join lateral (
  select client.id
    from public.clients client
   where lower(client.primary_email) = lower(account.email)
   order by client.created_at asc
   limit 1
) matching_client
where account.email is not null
  and btrim(account.email) <> ''
on conflict (user_id) do update
  set client_id = excluded.client_id,
      email = excluded.email,
      email_confirmed_at = excluded.email_confirmed_at,
      source = excluded.source,
      updated_at = now();

alter table public.client_auth_accounts enable row level security;

drop policy if exists platform_admin_read_client_auth_accounts on public.client_auth_accounts;
create policy platform_admin_read_client_auth_accounts
  on public.client_auth_accounts
  for select
  to authenticated
  using (public.is_active_platform_admin());

revoke all on table public.client_auth_accounts from anon;
revoke all on table public.client_auth_accounts from authenticated;
grant select on table public.client_auth_accounts to authenticated;

comment on table public.client_auth_accounts is
  'Links public Ximo website accounts to client records so admins can see pending, unverified, and subscribed customers without exposing auth.users.';

notify pgrst, 'reload schema';

commit;


