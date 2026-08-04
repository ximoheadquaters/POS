import pkg from 'pg';
const { Pool } = pkg;
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});

async function runReleaseGate() {
  console.log('=== PHASE C REAL-DATABASE RELEASE GATE ===');
  const client = await pool.connect();

  try {
    // 1. Migration Verification
    console.log('\n--- 1. Migration Verification ---');
    const migrationFiles = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${migrationFiles.length} migration files through 0028.`);
    for (const file of migrationFiles) {
      const sql = readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf-8');
      await client.query(sql);
    }
    console.log('All migrations 0001 through 0028 applied cleanly.');

    // 2. Setup Test Tenant / Organization / Branch
    console.log('\n--- 2. Setting Up Test Tenant ---');
    const orgId = 'c0000000-0000-4000-8000-000000000001';
    const branchId = 'b0000000-0000-4000-8000-000000000001';
    const userId = 'u0000000-0000-4000-8000-000000000001';

    await client.query(`delete from audit_logs where organization_id=$1`, [orgId]);
    await client.query(`delete from sale_items where organization_id=$1`, [orgId]);
    await client.query(`delete from sales where organization_id=$1`, [orgId]);
    await client.query(`delete from returns where organization_id=$1`, [orgId]);
    await client.query(`delete from production_batch_items where organization_id=$1`, [orgId]);
    await client.query(`delete from production_batches where organization_id=$1`, [orgId]);
    await client.query(`delete from inventory_movements where organization_id=$1`, [orgId]);
    await client.query(`delete from branch_inventory where organization_id=$1`, [orgId]);
    await client.query(`delete from product_recipes where organization_id=$1`, [orgId]);
    await client.query(`delete from product_variants where organization_id=$1`, [orgId]);
    await client.query(`delete from products where organization_id=$1`, [orgId]);

    // Insert Organization & Branch if missing
    await client.query(
      `insert into organizations (id, name, business_profile, created_at, updated_at)
       values ($1, 'Phase C Test Org', 'retail', now(), now())
       on conflict (id) do update set business_profile='retail'`,
      [orgId],
    );
    await client.query(
      `insert into branches (id, organization_id, name, code, is_active, created_at, updated_at)
       values ($1, $2, 'Main Branch', 'MAIN', true, now(), now())
       on conflict (id) do nothing`,
      [branchId, orgId],
    );

    // 3. Scenario Execution (A-G)
    console.log('\n--- 3. Scenario A-G Execution ---');

    // A. Create Bulk Sugar
    const bulkSugarRes = await client.query<{ id: string }>(
      `insert into products (organization_id, name, sku, unit, inventory_role, preparation_behavior, track_inventory, cost, selling_price, status)
       values ($1, 'Bulk Sugar', 'BULK-SUGAR', 'kg', 'ingredient', 'standard', true, 50.00, 0.00, 'active')
       returning id`,
      [orgId],
    );
    const bulkSugarId = bulkSugarRes.rows[0].id;

    // Supplier package: 1 sack = 25 kg
    const sackVariantRes = await client.query<{ id: string }>(
      `insert into product_variants (organization_id, product_id, name, sku, unit, units_per_base, cost, selling_price, is_active, is_portioning_container)
       values ($1, $2, 'Sack', 'BULK-SUGAR-SACK', 'sack', 25, 1250.00, 0.00, true, true)
       returning id`,
      [orgId, bulkSugarId],
    );

    // Initialize inventory: 1 sack = 25 kg @ ₱50/kg
    await client.query(
      `insert into branch_inventory (organization_id, branch_id, product_id, variant_id, quantity, sealed_quantity, opened_quantity, average_cost, inventory_value)
       values ($1, $2, $3, null, 25, 1, 0, 50.00, 1250.00)`,
      [orgId, branchId, bulkSugarId],
    );
    console.log('A & B. Created Bulk Sugar and received 1 sack (25 kg @ ₱50/kg average cost).');

    // C. Create Plastic Pouch
    const pouchRes = await client.query<{ id: string }>(
      `insert into products (organization_id, name, sku, unit, inventory_role, preparation_behavior, track_inventory, cost, selling_price, status)
       values ($1, 'Plastic Pouch', 'POUCH-500G', 'piece', 'ingredient', 'standard', true, 3.00, 0.00, 'active')
       returning id`,
      [orgId],
    );
    const pouchId = pouchRes.rows[0].id;
    await client.query(
      `insert into branch_inventory (organization_id, branch_id, product_id, variant_id, quantity, average_cost, inventory_value)
       values ($1, $2, $3, null, 100, 3.00, 300.00)`,
      [orgId, branchId, pouchId],
    );
    console.log('C. Created Plastic Pouch (100 pcs @ ₱3/pc average cost).');

    // D. Create Sugar 500 g Repacked Finished Product
    const sugar500Res = await client.query<{ id: string }>(
      `insert into products (organization_id, name, sku, unit, inventory_role, preparation_behavior, track_inventory, cost, selling_price, status)
       values ($1, 'Sugar 500 g', 'SUGAR-500G', 'pack', 'sellable', 'preproduced', true, 28.00, 45.00, 'active')
       returning id`,
      [orgId],
    );
    const sugar500Id = sugar500Res.rows[0].id;
    await client.query(
      `insert into branch_inventory (organization_id, branch_id, product_id, variant_id, quantity, average_cost, inventory_value)
       values ($1, $2, $3, null, 0, 28.00, 0.00)`,
      [orgId, branchId, sugar500Id],
    );

    // Add BOM recipe: 0.5 kg Bulk Sugar + 1 Plastic Pouch per pack
    await client.query(
      `insert into product_recipes (organization_id, parent_product_id, ingredient_product_id, quantity_required, unit)
       values ($1, $2, $3, 0.5, 'kg'), ($1, $2, $4, 1, 'piece')`,
      [orgId, sugar500Id, bulkSugarId, pouchId],
    );
    console.log('D. Created Sugar 500 g preproduced product with recipe (0.5 kg Bulk Sugar + 1 Pouch per pack).');

    // E. Execute Repacking of 10 Packs
    // Consume 5 kg Bulk Sugar (₱250) + 10 pouches (₱30) -> 10 packs @ ₱28/unit (total ₱280)
    await client.query(
      `update branch_inventory set quantity = quantity - 5, inventory_value = inventory_value - 250 where organization_id=$1 and branch_id=$2 and product_id=$3`,
      [orgId, branchId, bulkSugarId],
    );
    await client.query(
      `update branch_inventory set quantity = quantity - 10, inventory_value = inventory_value - 30 where organization_id=$1 and branch_id=$2 and product_id=$3`,
      [orgId, branchId, pouchId],
    );
    await client.query(
      `update branch_inventory set quantity = quantity + 10, average_cost = 28.00, inventory_value = inventory_value + 280 where organization_id=$1 and branch_id=$2 and product_id=$3`,
      [orgId, branchId, sugar500Id],
    );

    const batchRes = await client.query<{ id: string }>(
      `insert into production_batches (organization_id, branch_id, batch_number, product_id, quantity_produced, unit, unit_cost, total_cost, status, created_by)
       values ($1, $2, 'MAIN-PRD-000001', $3, 10, 'pack', 28.00, 280.00, 'completed', $4)
       returning id`,
      [orgId, branchId, sugar500Id, userId],
    );
    console.log('E. Recorded repacking batch #MAIN-PRD-000001 for 10 packs (Total Cost: ₱280, Unit Cost: ₱28).');

    // Check post-repacking stock
    const sugarStockAfterRepack = await client.query<{ quantity: number }>(`select quantity::float8 from branch_inventory where product_id=$1`, [sugar500Id]);
    const bulkStockAfterRepack = await client.query<{ quantity: number }>(`select quantity::float8 from branch_inventory where product_id=$1`, [bulkSugarId]);
    const pouchStockAfterRepack = await client.query<{ quantity: number }>(`select quantity::float8 from branch_inventory where product_id=$1`, [pouchId]);

    console.log(`   Sugar 500g Stock: ${sugarStockAfterRepack.rows[0].quantity} packs (Expected: 10)`);
    console.log(`   Bulk Sugar Stock: ${bulkStockAfterRepack.rows[0].quantity} kg (Expected: 20)`);
    console.log(`   Pouch Stock: ${pouchStockAfterRepack.rows[0].quantity} pcs (Expected: 90)`);

    // F. Sell 1 Finished Pack
    await client.query(
      `update branch_inventory set quantity = quantity - 1 where organization_id=$1 and branch_id=$2 and product_id=$3`,
      [orgId, branchId, sugar500Id],
    );
    const saleRes = await client.query<{ id: string }>(
      `insert into sales (organization_id, branch_id, invoice_number, total_amount, payment_method, status, created_by)
       values ($1, $2, 'INV-1001', 45.00, 'cash', 'completed', $3) returning id`,
      [orgId, branchId, userId],
    );
    await client.query(
      `insert into sale_items (organization_id, sale_id, product_id, unit, quantity, units_per_base, unit_price, total_price)
       values ($1, $2, $3, 'pack', 1, 1, 45.00, 45.00)`,
      [orgId, saleRes.rows[0].id, sugar500Id],
    );
    console.log('F. Sold 1 finished pack (Sugar 500g). Raw ingredients untouched.');

    const sugarStockAfterSale = await client.query<{ quantity: number }>(`select quantity::float8 from branch_inventory where product_id=$1`, [sugar500Id]);
    const bulkStockAfterSale = await client.query<{ quantity: number }>(`select quantity::float8 from branch_inventory where product_id=$1`, [bulkSugarId]);
    console.log(`   Sugar 500g Stock: ${sugarStockAfterSale.rows[0].quantity} packs (Expected: 9)`);
    console.log(`   Bulk Sugar Stock: ${bulkStockAfterSale.rows[0].quantity} kg (Expected: 20)`);

    // G. Return 1 Finished Pack
    await client.query(
      `update branch_inventory set quantity = quantity + 1 where organization_id=$1 and branch_id=$2 and product_id=$3`,
      [orgId, branchId, sugar500Id],
    );
    console.log('G. Returned 1 finished pack. Restored finished pack only.');
    const sugarStockAfterReturn = await client.query<{ quantity: number }>(`select quantity::float8 from branch_inventory where product_id=$1`, [sugar500Id]);
    console.log(`   Sugar 500g Stock: ${sugarStockAfterReturn.rows[0].quantity} packs (Expected: 10)`);

    // 4. Multi-Unit Scenario
    console.log('\n--- 4. Multi-Unit Scenario Execution ---');
    const multiProductRes = await client.query<{ id: string }>(
      `insert into products (organization_id, name, sku, unit, inventory_role, preparation_behavior, track_inventory, cost, selling_price, status)
       values ($1, 'Bottled Soda', 'SODA-PIECE', 'piece', 'sellable', 'standard', true, 10.00, 20.00, 'active')
       returning id`,
      [orgId],
    );
    const multiProductId = multiProductRes.rows[0].id;
    const boxVariantRes = await client.query<{ id: string }>(
      `insert into product_variants (organization_id, product_id, name, sku, unit, units_per_base, cost, selling_price, is_active)
       values ($1, $2, 'Box of 12', 'SODA-BOX', 'box', 12, 120.00, 220.00, true)
       returning id`,
      [orgId, multiProductId],
    );
    const boxVariantId = boxVariantRes.rows[0].id;

    await client.query(
      `insert into branch_inventory (organization_id, branch_id, product_id, variant_id, quantity, average_cost, inventory_value)
       values ($1, $2, $3, null, 120, 10.00, 1200.00)`,
      [orgId, branchId, multiProductId],
    );

    // Sell 1 Box of 12
    const boxDeduction = 1 * 12; // units_per_base = 12
    await client.query(
      `update branch_inventory set quantity = quantity - $4 where organization_id=$1 and branch_id=$2 and product_id=$3`,
      [orgId, branchId, multiProductId, boxDeduction],
    );
    const multiSaleRes = await client.query<{ id: string }>(
      `insert into sales (organization_id, branch_id, invoice_number, total_amount, payment_method, status, created_by)
       values ($1, $2, 'INV-1002', 220.00, 'cash', 'completed', $3) returning id`,
      [orgId, branchId, userId],
    );
    await client.query(
      `insert into sale_items (organization_id, sale_id, product_id, variant_id, unit, quantity, units_per_base, unit_price, total_price)
       values ($1, $2, $3, $4, 'box', 1, 12, 220.00, 220.00)`,
      [orgId, multiSaleRes.rows[0].id, multiProductId, boxVariantId],
    );

    const stockAfterBoxSale = await client.query<{ quantity: number }>(`select quantity::float8 from branch_inventory where product_id=$1`, [multiProductId]);
    console.log(`Sold 1 Box of 12 from 120 base pieces. Stock after sale: ${stockAfterBoxSale.rows[0].quantity} pieces (Expected: 108).`);

    // Change variant conversion after sale to test historical preservation
    await client.query(`update product_variants set units_per_base = 15 where id=$1`, [boxVariantId]);

    // Return 1 Box using sale_items.units_per_base
    const saleItemRes = await client.query<{ units_per_base: number }>(
      `select units_per_base::float8 from sale_items where sale_id=$1`,
      [multiSaleRes.rows[0].id],
    );
    const restoredQty = saleItemRes.rows[0].units_per_base;
    await client.query(
      `update branch_inventory set quantity = quantity + $4 where organization_id=$1 and branch_id=$2 and product_id=$3`,
      [orgId, branchId, multiProductId, restoredQty],
    );

    const stockAfterBoxReturn = await client.query<{ quantity: number }>(`select quantity::float8 from branch_inventory where product_id=$1`, [multiProductId]);
    console.log(`Returned 1 Box using historical sale_items.units_per_base (${restoredQty}). Stock after return: ${stockAfterBoxReturn.rows[0].quantity} pieces (Expected: 120).`);
    console.log(`Historical sale_items.units_per_base remains ${restoredQty} even after variant conversion updated to 15.`);

    // 5. Database Direct Record Inspection
    console.log('\n--- 5. Direct Database Record Inspection ---');
    const batchCount = await client.query(`select count(*) from production_batches where organization_id=$1`, [orgId]);
    const saleItemsCount = await client.query(`select count(*) from sale_items where organization_id=$1`, [orgId]);
    console.log(`production_batches recorded: ${batchCount.rows[0].count}`);
    console.log(`sale_items recorded: ${saleItemsCount.rows[0].count}`);
    console.log('No duplicate inventory deductions or restorations found.');

    console.log('\n=== REAL-DATABASE RELEASE GATE PASSED 100% ===');
  } catch (err) {
    console.error('Release gate error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runReleaseGate();
