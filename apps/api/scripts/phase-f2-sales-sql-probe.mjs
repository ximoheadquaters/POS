import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const org = '11111111-1111-4111-8111-111111111111';
const fromIso = '2026-07-08T00:00:00.000Z';
const toIso = '2026-08-07T00:00:00.000Z';
const values = [org, fromIso, toIso, null, true, [], null, 20, 0];

const branchScopeSQL = (alias) =>
  `($4::uuid is null or ${alias}.branch_id=$4)
   and ($5::boolean or ${alias}.branch_id=any($6::uuid[]))`;
const searchSQL = (alias) => `($7::text is null or ${alias}.receipt_number ilike $7)`;

const queries = {
  summary: `
    with scoped_sales as (
      select * from sales s
      where s.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
        and s.status in ('completed','partially_refunded','refunded')
        and ${branchScopeSQL('s')}
        and ${searchSQL('s')}
    ),
    sale_cost as (
      select coalesce(sum(si.quantity * si.unit_cost), 0) as total
      from sale_items si join scoped_sales s on s.id = si.sale_id
    ),
    scoped_returns as (
      select r.* from returns r
      where r.organization_id=$1 and r.created_at >= $2 and r.created_at < $3
        and ${branchScopeSQL('r')}
    ),
    return_cost as (
      select coalesce(sum(ri.quantity * si.unit_cost), 0) as total
      from return_items ri
      join scoped_returns r on r.id = ri.return_id
      join sale_items si on si.id = ri.sale_item_id
    )
    select
      coalesce(sum(s.subtotal), 0)::text as "merchandiseSubtotal",
      ((select total from sale_cost) - (select total from return_cost))::text as "cogs"
    from scoped_sales s`,
  list: `
    select
      s.id,
      s.receipt_number as "receiptNumber",
      coalesce((select string_agg(distinct method::text, ', ') from payments pay where pay.sale_id = s.id), 'cash') as "paymentMethod",
      coalesce((select sum(si.quantity * coalesce(si.units_per_base, 1)) from sale_items si where si.sale_id = s.id), 0)::float8 as "baseUnitsSold"
    from sales s
    join branches b on b.id = s.branch_id
    left join profiles p on p.id = s.cashier_id
    where s.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
      and s.status in ('completed','partially_refunded','refunded')
      and ${branchScopeSQL('s')}
      and ${searchSQL('s')}
    order by s.completed_at desc
    limit $8 offset $9`,
  count: `
    select count(*)::int as "totalRows" from sales s
    where s.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
      and s.status in ('completed','partially_refunded','refunded')
      and ${branchScopeSQL('s')}
      and ${searchSQL('s')}`,
  trend: `
    select
      to_char(s.completed_at at time zone $10, 'YYYY-MM-DD') as period,
      coalesce(sum(s.total), 0)::text as "finalSales",
      coalesce((select sum(refund_total) from returns r where r.organization_id = $1 and r.created_at >= $2 and r.created_at < $3 and ${branchScopeSQL('r')}), 0)::text as refunds,
      (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from returns r where r.organization_id = $1 and r.created_at >= $2 and r.created_at < $3 and ${branchScopeSQL('r')}), 0))::text as "netSales"
    from sales s
    where s.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
      and s.status in ('completed','partially_refunded','refunded')
      and ${branchScopeSQL('s')}
    group by 1 order by 1 asc`,
};

const results = {};
for (const [name, sql] of Object.entries(queries)) {
  try {
    const params = name === 'trend' ? [...values, 'Asia/Manila'] : values;
    const r = await client.query(sql, params);
    results[name] = { ok: true, rows: r.rowCount, sample: r.rows[0] ?? null };
  } catch (error) {
    results[name] = { ok: false, message: error.message, code: error.code };
  }
}

console.log(JSON.stringify(results, null, 2));
await client.end();
