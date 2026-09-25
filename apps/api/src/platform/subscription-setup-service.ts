import type { Database } from '../database/types.js';
import { badRequest, notFound } from '../shared/errors.js';

// Called only by an authenticated platform client after payment reconciliation.
// The organization lock makes retries and simultaneous webhook deliveries safe.
export async function setupSubscriptionBranches(database: Database, organizationId: string, count: number, orderId: string) {
  return database.transaction(async transaction => {
    const organization = await transaction.query('select id from organizations where id=$1 for update', [organizationId]);
    if (!organization.rows[0]) throw notFound('Organization');
    const completed = await transaction.query('select id from audit_logs where organization_id=$1 and action=$2 and entity_id=$3', [organizationId, 'subscription.branches.configured', orderId]);
    if (completed.rows.length) return { branchCount: count };
    const owners = await transaction.query<{ id: string }>(
      `select p.id from profiles p join roles r on r.id=p.role_id
       where p.organization_id=$1 and r.code='owner' and p.is_active`, [organizationId]);
    if (!owners.rows.length) throw badRequest('OWNER_REQUIRED', 'A subscription owner is required to set up branches.');
    const existing = await transaction.query<{ id: string }>('select id from branches where organization_id=$1 and is_active order by created_at', [organizationId]);
    const codes = await transaction.query<{ code: string }>('select code from branches where organization_id=$1', [organizationId]);
    const usedCodes = new Set(codes.rows.map(branch => branch.code));
    let sequence = 2;
    for (let index = existing.rows.length; index < count; index++) {
      // Reserve subscription-specific codes. A name change does not create duplicates on retry.
      while (usedCodes.has(`SUB-${sequence}`)) sequence++;
      const code = `SUB-${sequence++}`;
      usedCodes.add(code);
      const branch = await transaction.query<{ id: string }>(
        `insert into branches (organization_id,name,code,is_active) values ($1,$2,$3,true)
         on conflict (organization_id,code) do update set is_active=true returning id`,
        [organizationId, `Branch ${index + 1}`, code]);
      const branchId = branch.rows[0]!.id;
      await transaction.query(
        `insert into registers (organization_id,branch_id,name,code,is_active) values ($1,$2,'Main Counter','MAIN-01',true)
         on conflict (branch_id,code) do nothing`, [organizationId, branchId]);
      for (const owner of owners.rows) await transaction.query(
        `insert into user_branches (organization_id,user_id,branch_id) values ($1,$2,$3)
         on conflict (user_id,branch_id) do nothing`, [organizationId, owner.id, branchId]);
    }
    await transaction.query(
      `insert into audit_logs (organization_id,actor_id,action,entity_type,entity_id,after_data)
       values ($1,$2,'subscription.branches.configured','subscription_order',$3,$4::jsonb)`,
      [organizationId, owners.rows[0]!.id, orderId, JSON.stringify({ branchCount: count })]);
    return { branchCount: Math.max(existing.rows.length, count) };
  });
}
