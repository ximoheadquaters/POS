import { Router } from 'express';
import { organizationSettingsSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validation.js';
import { sendData } from '../../shared/http.js';

export function settingsRouter(database: Database): Router {
  const router = Router();
  router.get('/', async (request, response) => {
    const result = await database.query(
      `select os.business_name as "businessName",o.currency,o.timezone,
        os.tax_rate::text as "taxRate",os.receipt_header as "receiptHeader",
        os.receipt_footer as "receiptFooter",
        os.allow_negative_inventory as "allowNegativeInventory",
        os.payment_methods::text[] as "paymentMethods",
        os.target_margin_percent::text as "targetMarginPercent",
        os.low_margin_threshold_percent::text as "lowMarginThresholdPercent"
       from organization_settings os join organizations o on o.id=os.organization_id
       where os.organization_id=$1`,
      [request.authUser!.organization.id],
    );
    sendData(response, result.rows[0]);
  });
  router.put(
    '/',
    requirePermission('settings:manage'),
    validateBody(organizationSettingsSchema),
    async (request, response) => {
      const input = request.body;
      const organizationId = request.authUser!.organization.id;
      const result = await database.transaction(async (tx) => {
        await tx.query('update organizations set name=$2,currency=$3,timezone=$4 where id=$1', [
          organizationId,
          input.businessName,
          input.currency,
          input.timezone,
        ]);
        const updated = await tx.query(
          `update organization_settings set business_name=$2,tax_rate=$3,receipt_header=$4,
            receipt_footer=$5,allow_negative_inventory=$6,payment_methods=$7,
            target_margin_percent=$8,low_margin_threshold_percent=$9,updated_at=now()
           where organization_id=$1
           returning business_name as "businessName",tax_rate::text as "taxRate",
            receipt_header as "receiptHeader",receipt_footer as "receiptFooter",
            allow_negative_inventory as "allowNegativeInventory",
            payment_methods::text[] as "paymentMethods",
            target_margin_percent::text as "targetMarginPercent",
            low_margin_threshold_percent::text as "lowMarginThresholdPercent"`,
          [
            organizationId,
            input.businessName,
            input.taxRate,
            input.receiptHeader,
            input.receiptFooter,
            input.allowNegativeInventory,
            input.paymentMethods,
            input.targetMarginPercent,
            input.lowMarginThresholdPercent,
          ],
        );
        await tx.query(
          `insert into audit_logs (
            organization_id,actor_id,action,entity_type,entity_id,after_data
           ) values ($1,$2,'settings.updated','organization',$1,$3::jsonb)`,
          [organizationId, request.authUser!.id, JSON.stringify(input)],
        );
        return updated.rows[0];
      });
      sendData(response, result);
    },
  );
  return router;
}
