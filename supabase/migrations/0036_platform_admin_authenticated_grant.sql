begin;

-- RLS decides which active administrator row a signed-in user may read, but
-- PostgREST also requires the authenticated database role to have the base
-- SELECT privilege. Anonymous users and all write operations remain blocked.
grant select on table public.platform_admins to authenticated;

commit;
