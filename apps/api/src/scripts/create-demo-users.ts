import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../config.js';

const config = loadConfig();
const url = config.SUPABASE_URL;
const serviceRoleKey = config.SUPABASE_SERVICE_ROLE_KEY;

const organizationId = '10000000-0000-4000-8000-000000000001';
const bacolod = '20000000-0000-4000-8000-000000000001';
const talisay = '20000000-0000-4000-8000-000000000002';
const roles = {
  owner: '30000000-0000-4000-8000-000000000001',
  manager: '30000000-0000-4000-8000-000000000003',
  cashier: '30000000-0000-4000-8000-000000000004',
} as const;

const users = [
  {
    email: 'owner@ximo.local',
    password: process.env.DEMO_OWNER_PASSWORD,
    name: 'Demo Owner',
    roleId: roles.owner,
    branches: [bacolod, talisay],
  },
  {
    email: 'manager@ximo.local',
    password: process.env.DEMO_MANAGER_PASSWORD,
    name: 'Demo Manager',
    roleId: roles.manager,
    branches: [bacolod, talisay],
  },
  {
    email: 'cashier.bacolod@ximo.local',
    password: process.env.DEMO_CASHIER_1_PASSWORD,
    name: 'Bacolod Cashier',
    roleId: roles.cashier,
    branches: [bacolod],
  },
  {
    email: 'cashier.talisay@ximo.local',
    password: process.env.DEMO_CASHIER_2_PASSWORD,
    name: 'Talisay Cashier',
    roleId: roles.cashier,
    branches: [talisay],
  },
];

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const user of users) {
  if (!user.password || user.password.length < 12) {
    throw new Error(`Set a unique password of at least 12 characters for ${user.email}`);
  }
  const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  let authUser = listed.data.users.find((entry) => entry.email === user.email);
  if (!authUser) {
    const created = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { display_name: user.name },
    });
    if (created.error) throw created.error;
    authUser = created.data.user;
  }
  const profile = await supabase.from('profiles').upsert({
    id: authUser.id,
    organization_id: organizationId,
    role_id: user.roleId,
    display_name: user.name,
    email: user.email,
    is_active: true,
  });
  if (profile.error) throw profile.error;
  const cleared = await supabase.from('user_branches').delete().eq('user_id', authUser.id);
  if (cleared.error) throw cleared.error;
  const assignments = await supabase.from('user_branches').insert(
    user.branches.map((branchId) => ({
      organization_id: organizationId,
      user_id: authUser!.id,
      branch_id: branchId,
    })),
  );
  if (assignments.error) throw assignments.error;
  console.log(`Ready: ${user.email}`);
}
