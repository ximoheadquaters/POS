import { convertRecipeQuantity, type ProductionBatchInput } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';

interface ProductionActor {
  userId: string;
  organizationId: string;
}

interface OutputProductRow {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitKind: 'discrete' | 'decimal';
  quantity: number;
}

interface IngredientRow {
  ingredientProductId: string;
  ingredientName: string;
  ingredientVariantId: string | null;
  quantityRequired: number;
  recipeUnit: string;
  baseUnit: string;
  quantity: number;
  averageCost: number;
  sealedQuantity: number;
  openedQuantity: number;
  portioningVariantId: string | null;
  containerName: string | null;
  containerUnit: string | null;
  unitsPerBase: number | null;
}

function inventoryQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function moneyQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export class ProductionService {
  constructor(private readonly database: Database) {}

  async create(actor: ProductionActor, input: ProductionBatchInput) {
    return this.database.transaction(async (transaction) => {
      const settings = await transaction.query<{ allowNegativeInventory: boolean }>(
        `select allow_negative_inventory as "allowNegativeInventory"
         from organization_settings where organization_id=$1`,
        [actor.organizationId],
      );
      const allowNegative = settings.rows[0]?.allowNegativeInventory ?? false;

      const outputResult = await transaction.query<OutputProductRow>(
        `select p.id,p.name,p.sku,p.unit,pu.kind as "unitKind",bi.quantity::float8 as quantity
         from products p
         join product_units pu on pu.organization_id=p.organization_id and pu.code=p.unit
         join branch_inventory bi on bi.organization_id=p.organization_id
           and bi.branch_id=$2 and bi.product_id=p.id and bi.variant_id is null
         where p.organization_id=$1 and p.id=$3 and p.status='active'
           and p.track_inventory and p.inventory_role in ('sellable','both')
           and coalesce(p.preparation_behavior, 'preproduced') = 'preproduced'
         for update of bi`,
        [actor.organizationId, input.branchId, input.productId],
      );
      const output = outputResult.rows[0];
      if (!output) {
        throw notFound('Active inventory-tracked finished product');
      }
      if (output.unitKind === 'discrete' && !Number.isInteger(input.quantityProduced)) {
        throw badRequest(
          'WHOLE_PRODUCTION_QUANTITY',
          `${output.name} must be produced in whole ${output.unit} quantities`,
        );
      }

      const ingredientsResult = await transaction.query<IngredientRow>(
        `select pr.ingredient_product_id as "ingredientProductId",
          ingredient.name as "ingredientName",
          pr.ingredient_variant_id as "ingredientVariantId",
          pr.quantity_required::float8 as "quantityRequired",pr.unit as "recipeUnit",
          ingredient.unit as "baseUnit",
          coalesce(bi.quantity, 0)::float8 as quantity,
          coalesce(bi.average_cost, ingredient.cost, 0)::float8 as "averageCost",
          coalesce(bi.sealed_quantity, 0)::float8 as "sealedQuantity",
          coalesce(bi.opened_quantity, 0)::float8 as "openedQuantity",
          container.id as "portioningVariantId",container.name as "containerName",
          container.unit as "containerUnit",container.units_per_base::float8 as "unitsPerBase"
         from product_recipes pr
         join products ingredient on ingredient.organization_id=pr.organization_id
           and ingredient.id=pr.ingredient_product_id
         left join branch_inventory bi on bi.organization_id=pr.organization_id
           and bi.branch_id=$2 and bi.product_id=pr.ingredient_product_id
           and bi.variant_id is not distinct from pr.ingredient_variant_id
         left join product_variants container on container.organization_id=ingredient.organization_id
           and container.product_id=ingredient.id and container.is_portioning_container
           and container.is_active
         where pr.organization_id=$1 and pr.parent_product_id=$3
         order by pr.ingredient_product_id
         for update of bi`,
        [actor.organizationId, input.branchId, input.productId],
      );
      if (!ingredientsResult.rows.length) {
        throw badRequest(
          'PRODUCTION_RECIPE_REQUIRED',
          'Add a BOM recipe to this finished product before recording production',
        );
      }

      const batchNumberResult = await transaction.query<{ batchNumber: string }>(
        `select b.code || '-PRD-' || to_char(now() at time zone 'UTC','YYYYMMDD') || '-' ||
           lpad(nextval('production_batch_number_seq')::text,6,'0') as "batchNumber"
         from branches b where b.organization_id=$1 and b.id=$2`,
        [actor.organizationId, input.branchId],
      );
      const batchNumber = batchNumberResult.rows[0]?.batchNumber;
      if (!batchNumber) throw notFound('Branch');
      const batchResult = await transaction.query<{ id: string }>(
        `insert into production_batches (
           organization_id,branch_id,batch_number,product_id,quantity_produced,notes,created_by
         ) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [
          actor.organizationId,
          input.branchId,
          batchNumber,
          output.id,
          input.quantityProduced,
          input.notes ?? null,
          actor.userId,
        ],
      );
      const batchId = batchResult.rows[0]!.id;
      const ingredientSummary: Array<{
        productId: string;
        name: string;
        quantityConsumed: number;
        unit: string;
        containersOpened: number;
      }> = [];
      let totalCost = 0;

      for (const ingredient of ingredientsResult.rows) {
        const requiredPerOutput = convertRecipeQuantity(
          ingredient.quantityRequired,
          ingredient.recipeUnit,
          ingredient.baseUnit,
        );
        const quantityConsumed = inventoryQuantity(requiredPerOutput * input.quantityProduced);
        if (quantityConsumed <= 0) {
          throw badRequest(
            'INVALID_RECIPE_QUANTITY',
            'Recipe quantities must be greater than zero',
          );
        }

        let sealedQuantity = Number(ingredient.sealedQuantity);
        let openedQuantity = Number(ingredient.openedQuantity);
        let containersOpened = 0;
        if (ingredient.portioningVariantId && openedQuantity < quantityConsumed) {
          const unitsPerBase = Number(ingredient.unitsPerBase ?? 0);
          if (unitsPerBase <= 0) {
            throw badRequest(
              'INVALID_CONTAINER_CONVERSION',
              `${ingredient.ingredientName} has an invalid storage package conversion`,
            );
          }
          containersOpened = Math.ceil(
            (quantityConsumed - openedQuantity - 0.000_000_1) / unitsPerBase,
          );
          if (!allowNegative && sealedQuantity < containersOpened) {
            throw conflict(
              'INSUFFICIENT_PRODUCTION_INVENTORY',
              `${ingredient.ingredientName} needs ${quantityConsumed} ${ingredient.baseUnit}, but there is not enough opened or sealed stock`,
            );
          }
          if (sealedQuantity >= containersOpened) {
            const openedState = await transaction.query<{
              sealedQuantity: number;
              openedQuantity: number;
            }>(
              `update branch_inventory set sealed_quantity=sealed_quantity-$4,
                 opened_quantity=opened_quantity+($4*$5),updated_at=now()
               where organization_id=$1 and branch_id=$2 and product_id=$3
                 and variant_id is not distinct from $6::uuid
               returning sealed_quantity::float8 as "sealedQuantity",
                 opened_quantity::float8 as "openedQuantity"`,
              [
                actor.organizationId,
                input.branchId,
                ingredient.ingredientProductId,
                containersOpened,
                unitsPerBase,
                ingredient.ingredientVariantId,
              ],
            );
            sealedQuantity = openedState.rows[0]!.sealedQuantity;
            openedQuantity = openedState.rows[0]!.openedQuantity;
            await transaction.query(
              `insert into inventory_pool_movements (
                 organization_id,branch_id,product_id,container_variant_id,movement_type,
                 sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
                 opened_quantity_after,reason,reference_type,reference_id,created_by
               ) values ($1,$2,$3,$4,'production_open',$5,$6,$7,$8,$9,
                 'production_batch',$10,$11)`,
              [
                actor.organizationId,
                input.branchId,
                ingredient.ingredientProductId,
                ingredient.portioningVariantId,
                -containersOpened,
                containersOpened * unitsPerBase,
                sealedQuantity,
                openedQuantity,
                `Opened automatically for ${output.name}`,
                batchId,
                actor.userId,
              ],
            );
          } else {
            containersOpened = 0;
          }
        }

        const consumedState = await transaction.query<{
          quantity: number;
          sealedQuantity: number;
          openedQuantity: number;
        }>(
          `update branch_inventory set quantity=quantity-$4,
             inventory_value=round(average_cost*(quantity-$4),4),
             opened_quantity=opened_quantity-case when $6::uuid is null then 0 else $4 end,
             updated_at=now()
           where organization_id=$1 and branch_id=$2 and product_id=$3
             and variant_id is not distinct from $5::uuid
             and ($7::boolean or quantity >= $4)
             and ($6::uuid is null or $7::boolean or opened_quantity >= $4)
           returning quantity::float8 as quantity,
             sealed_quantity::float8 as "sealedQuantity",
             opened_quantity::float8 as "openedQuantity"`,
          [
            actor.organizationId,
            input.branchId,
            ingredient.ingredientProductId,
            quantityConsumed,
            ingredient.ingredientVariantId,
            ingredient.portioningVariantId,
            allowNegative,
          ],
        );
        const state = consumedState.rows[0];
        if (!state) {
          throw conflict(
            'INSUFFICIENT_PRODUCTION_INVENTORY',
            `${ingredient.ingredientName} does not have enough stock for this batch`,
          );
        }
        const ingredientTotalCost = moneyQuantity(
          quantityConsumed * Number(ingredient.averageCost),
        );
        totalCost = moneyQuantity(totalCost + ingredientTotalCost);
        await transaction.query(
          `insert into inventory_movements (
             organization_id,branch_id,product_id,variant_id,movement_type,quantity_delta,
             quantity_after,reason,reference_type,reference_id,created_by
           ) values ($1,$2,$3,$4,'production_consumption',$5,$6,$7,
             'production_batch',$8,$9)`,
          [
            actor.organizationId,
            input.branchId,
            ingredient.ingredientProductId,
            ingredient.ingredientVariantId,
            -quantityConsumed,
            state.quantity,
            `Used to produce ${input.quantityProduced} ${output.unit} of ${output.name}`,
            batchId,
            actor.userId,
          ],
        );
        if (ingredient.portioningVariantId) {
          await transaction.query(
            `insert into inventory_pool_movements (
               organization_id,branch_id,product_id,container_variant_id,movement_type,
               sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
               opened_quantity_after,reason,reference_type,reference_id,created_by
             ) values ($1,$2,$3,$4,'production_consumption',0,$5,$6,$7,$8,
               'production_batch',$9,$10)`,
            [
              actor.organizationId,
              input.branchId,
              ingredient.ingredientProductId,
              ingredient.portioningVariantId,
              -quantityConsumed,
              state.sealedQuantity,
              state.openedQuantity,
              `Used to produce ${output.name}`,
              batchId,
              actor.userId,
            ],
          );
        }
        await transaction.query(
          `insert into production_batch_items (
             organization_id,production_batch_id,ingredient_product_id,quantity_consumed,
             unit_cost,total_cost,containers_opened
           ) values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            actor.organizationId,
            batchId,
            ingredient.ingredientProductId,
            quantityConsumed,
            ingredient.averageCost,
            ingredientTotalCost,
            containersOpened,
          ],
        );
        ingredientSummary.push({
          productId: ingredient.ingredientProductId,
          name: ingredient.ingredientName,
          quantityConsumed,
          unit: ingredient.baseUnit,
          containersOpened,
        });
      }

      const unitCost = moneyQuantity(totalCost / input.quantityProduced);
      const outputState = await transaction.query<{
        quantity: number;
        averageCost: string;
        inventoryValue: string;
      }>(
        `update branch_inventory set quantity=quantity+$4,
           inventory_value=round(inventory_value+$5,4),
           average_cost=case when quantity+$4=0 then 0
             else round((inventory_value+$5)/(quantity+$4),4) end,
           updated_at=now()
         where organization_id=$1 and branch_id=$2 and product_id=$3 and variant_id is null
         returning quantity::float8 as quantity,average_cost::text as "averageCost",
           inventory_value::text as "inventoryValue"`,
        [actor.organizationId, input.branchId, output.id, input.quantityProduced, totalCost],
      );
      await transaction.query(
        `insert into inventory_movements (
           organization_id,branch_id,product_id,variant_id,movement_type,quantity_delta,
           quantity_after,reason,reference_type,reference_id,created_by
         ) values ($1,$2,$3,null,'production_output',$4,$5,$6,
           'production_batch',$7,$8)`,
        [
          actor.organizationId,
          input.branchId,
          output.id,
          input.quantityProduced,
          outputState.rows[0]!.quantity,
          `Produced from BOM ingredients (${batchNumber})`,
          batchId,
          actor.userId,
        ],
      );
      await transaction.query(
        `update production_batches set unit_cost=$3,total_cost=$4
         where organization_id=$1 and id=$2`,
        [actor.organizationId, batchId, unitCost, totalCost],
      );
      await transaction.query(
        `insert into audit_logs (
           organization_id,branch_id,actor_id,action,entity_type,entity_id,after_data
         ) values ($1,$2,$3,'inventory.production_recorded','production_batch',$4,$5::jsonb)`,
        [
          actor.organizationId,
          input.branchId,
          actor.userId,
          batchId,
          JSON.stringify({ ...input, batchNumber, totalCost, unitCost }),
        ],
      );

      return {
        id: batchId,
        batchNumber,
        productId: output.id,
        productName: output.name,
        quantityProduced: input.quantityProduced,
        unit: output.unit,
        unitCost: unitCost.toFixed(4),
        totalCost: totalCost.toFixed(4),
        quantityAfter: outputState.rows[0]!.quantity,
        ingredients: ingredientSummary,
      };
    });
  }

  async preview(actor: ProductionActor, input: { branchId: string; productId: string; quantity: number }) {
    const outputResult = await this.database.query<OutputProductRow>(
      `select p.id,p.name,p.sku,p.unit,pu.kind as "unitKind",bi.quantity::float8 as quantity
       from products p
       join product_units pu on pu.organization_id=p.organization_id and pu.code=p.unit
       join branch_inventory bi on bi.organization_id=p.organization_id
         and bi.branch_id=$2 and bi.product_id=p.id and bi.variant_id is null
       where p.organization_id=$1 and p.id=$3 and p.status='active'
         and p.track_inventory and p.inventory_role in ('sellable','both')
         and coalesce(p.preparation_behavior, 'preproduced') = 'preproduced'`,
      [actor.organizationId, input.branchId, input.productId],
    );
    const output = outputResult.rows[0];
    if (!output) {
      throw notFound('Active inventory-tracked finished product');
    }

    const ingredientsResult = await this.database.query<IngredientRow>(
      `select pr.ingredient_product_id as "ingredientProductId",
        ingredient.name as "ingredientName",
        pr.ingredient_variant_id as "ingredientVariantId",
        pr.quantity_required::float8 as "quantityRequired",pr.unit as "recipeUnit",
        ingredient.unit as "baseUnit",
        coalesce(bi.quantity, 0)::float8 as quantity,
        coalesce(bi.average_cost, ingredient.cost, 0)::float8 as "averageCost",
        coalesce(bi.sealed_quantity, 0)::float8 as "sealedQuantity",
        coalesce(bi.opened_quantity, 0)::float8 as "openedQuantity",
        container.id as "portioningVariantId",container.name as "containerName",
        container.unit as "containerUnit",container.units_per_base::float8 as "unitsPerBase"
       from product_recipes pr
       join products ingredient on ingredient.organization_id=pr.organization_id
         and ingredient.id=pr.ingredient_product_id
       left join branch_inventory bi on bi.organization_id=pr.organization_id
         and bi.branch_id=$2 and bi.product_id=pr.ingredient_product_id
         and bi.variant_id is not distinct from pr.ingredient_variant_id
       left join product_variants container on container.organization_id=ingredient.organization_id
         and container.product_id=ingredient.id and container.is_portioning_container
         and container.is_active
       where pr.organization_id=$1 and pr.parent_product_id=$3
       order by ingredient.name`,
      [actor.organizationId, input.branchId, input.productId],
    );

    if (ingredientsResult.rows.length === 0) {
      throw badRequest(
        'MISSING_RECIPE',
        'Add a BOM recipe to this finished product before recording production',
      );
    }

    let totalCost = 0;
    let canProduce = true;
    const requirements = ingredientsResult.rows.map((row) => {
      const requiredQtyPerUnit = convertRecipeQuantity(row.quantityRequired, row.recipeUnit, row.baseUnit);
      const totalRequired = moneyQuantity(requiredQtyPerUnit * input.quantity);
      const ingredientCost = moneyQuantity(totalRequired * row.averageCost);
      totalCost += ingredientCost;
      const sufficient = row.quantity >= totalRequired;
      if (!sufficient) canProduce = false;
      return {
        productId: row.ingredientProductId,
        name: row.ingredientName,
        requiredQuantity: totalRequired,
        unit: row.baseUnit,
        availableQuantity: row.quantity,
        sufficient,
        estimatedCost: ingredientCost.toFixed(2),
      };
    });

    const unitCost = input.quantity > 0 ? moneyQuantity(totalCost / input.quantity) : 0;

    return {
      productId: output.id,
      productName: output.name,
      quantity: input.quantity,
      requirements,
      estimatedTotalCost: totalCost.toFixed(2),
      estimatedUnitCost: unitCost.toFixed(2),
      canProduce,
    };
  }
}
