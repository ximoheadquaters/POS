begin;

-- The official website resolves a signed-in user's platform role directly
-- from the unified identity database. A user may only read their own active
-- administrator row; all platform administration writes remain server-only.
create policy platform_admin_read_self
  on public.platform_admins
  for select
  to authenticated
  using (id = auth.uid() and is_active);

commit;
