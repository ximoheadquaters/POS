-- Phase F2: granular report capability permissions
-- Existing installs only had reports:read; cost/profit/export capabilities were added in app code.

INSERT INTO public.permissions (code, description) VALUES
  ('reports:view_cost', 'View cost of goods and inventory valuation in reports'),
  ('reports:view_profit', 'View gross profit and margin in reports'),
  ('reports:view_all_branches', 'View report data across all organization branches'),
  ('reports:export', 'Export reports'),
  ('reports:manage_saved_views', 'Create and manage saved report views'),
  ('reports:view_staff', 'View staff attribution in reports'),
  ('reports:view_tax', 'View tax breakdowns in reports'),
  ('reports:view_platform', 'View platform-level reporting diagnostics')
ON CONFLICT (code) DO NOTHING;

-- Owners and administrators receive the full report capability set.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code IN ('owner', 'administrator')
  AND p.code IN (
    'reports:view_cost',
    'reports:view_profit',
    'reports:view_all_branches',
    'reports:export',
    'reports:manage_saved_views',
    'reports:view_staff',
    'reports:view_tax',
    'reports:view_platform'
  )
ON CONFLICT DO NOTHING;

-- Managers may view cost/profit and cross-branch reports, but not platform diagnostics.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'manager'
  AND p.code IN (
    'reports:read',
    'reports:view_cost',
    'reports:view_profit',
    'reports:view_all_branches',
    'reports:export',
    'reports:manage_saved_views',
    'reports:view_staff',
    'reports:view_tax'
  )
ON CONFLICT DO NOTHING;

-- Cashiers may open sales reports without cost or profit fields.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'cashier'
  AND p.code = 'reports:read'
ON CONFLICT DO NOTHING;
