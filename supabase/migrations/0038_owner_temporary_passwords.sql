begin;

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'Forces accounts provisioned with an administrator-generated password to replace it after first sign-in.';

commit;
