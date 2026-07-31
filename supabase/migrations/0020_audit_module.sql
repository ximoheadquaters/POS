insert into public.modules (code, name) values ('audit', 'Audit Logs')
on conflict (code) do nothing;

-- Add Audit Logs to business, professional, and enterprise plans
insert into public.plan_modules (plan_id, module_id)
select p.id, m.id from public.plans p cross join public.modules m
where m.code = 'audit' and p.code in ('business', 'professional', 'enterprise')
on conflict do nothing;
