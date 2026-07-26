begin;

alter table public.profiles
  add column invitation_sent_at timestamptz,
  add column invitation_resend_count integer not null default 0
    check (invitation_resend_count >= 0);

comment on column public.profiles.invitation_sent_at is
  'Last time an owner invitation or password-setup recovery email was accepted for delivery.';

comment on column public.profiles.invitation_resend_count is
  'Number of Platform API invitation resend requests completed for this profile.';

commit;
