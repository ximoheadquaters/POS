-- Add security PIN to profiles for manager approval overrides
alter table public.profiles
  add column if not exists pin text;

comment on column public.profiles.pin is '4 to 8 digit security PIN for manager authorization overrides';
