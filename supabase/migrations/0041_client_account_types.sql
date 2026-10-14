begin;

-- QA is a client account type. It describes who the workspace is for; it is
-- not a separate POS provisioning path.
alter table public.clients
  drop constraint if exists clients_kind_check;

alter table public.clients
  add constraint clients_kind_check
  check (kind in ('company', 'individual', 'qa'));

comment on column public.clients.kind is
  'The client account type: company, individual, or qa.';

notify pgrst, 'reload schema';

commit;
