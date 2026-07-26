import type { AuthActions } from '../auth/types.js';
import type { Database } from '../database/types.js';
import { conflict, notFound, tooManyRequests } from '../shared/errors.js';
import type { PlatformApiClient } from './auth.js';

const RESEND_COOLDOWN_SECONDS = 300;

interface OwnerRow {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  invitationSentAt: string | null;
}

interface ResendContext {
  apiClient: PlatformApiClient;
  auditMetadata: Record<string, string>;
}

export interface OwnerInvitationResult {
  accepted: true;
  organizationId: string;
  owner: {
    email: string;
    displayName: string;
    invitationStatus: 'pending';
  };
  sentAt: string;
}

export class OwnerInvitationService {
  constructor(
    private readonly database: Database,
    private readonly authActions: AuthActions,
  ) {}

  async resend(organizationId: string, context: ResendContext): Promise<OwnerInvitationResult> {
    return this.database.transaction(async (transaction) => {
      const organization = await transaction.query(
        'select id from organizations where id=$1 for update',
        [organizationId],
      );
      if (!organization.rows[0]) throw notFound('Organization');

      const ownerResult = await transaction.query<OwnerRow>(
        `select p.id,p.email,p.display_name as "displayName",p.created_at as "createdAt",
          p.invitation_sent_at as "invitationSentAt"
         from profiles p
         join roles r on r.id=p.role_id and r.organization_id=p.organization_id
         where p.organization_id=$1 and r.code='owner' and p.is_active
         order by p.created_at
         limit 1
         for update of p`,
        [organizationId],
      );
      const owner = ownerResult.rows[0];
      if (!owner) {
        throw conflict(
          'OWNER_INVITATION_NOT_AVAILABLE',
          'The organization does not have an active owner available for invitation',
        );
      }

      const previousSentAt = owner.invitationSentAt
        ? new Date(owner.invitationSentAt).getTime()
        : Number.NaN;
      const elapsedSeconds = Number.isFinite(previousSentAt)
        ? Math.floor((Date.now() - previousSentAt) / 1000)
        : RESEND_COOLDOWN_SECONDS;
      if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
        throw tooManyRequests(
          'OWNER_INVITATION_RATE_LIMITED',
          'An owner invitation was sent recently. Wait before requesting another.',
          { retryAfterSeconds: RESEND_COOLDOWN_SECONDS - Math.max(0, elapsedSeconds) },
        );
      }

      await this.authActions.resendOwnerInvitation(owner.email);
      const sentAt = new Date().toISOString();
      await transaction.query(
        `update profiles
         set invitation_sent_at=$2,invitation_resend_count=invitation_resend_count+1,
           updated_at=now()
         where id=$1`,
        [owner.id, sentAt],
      );

      const result: OwnerInvitationResult = {
        accepted: true,
        organizationId,
        owner: {
          email: owner.email,
          displayName: owner.displayName,
          invitationStatus: 'pending',
        },
        sentAt,
      };
      await transaction.query(
        `insert into platform_audit_logs (
          api_client_id,organization_id,action,before_data,after_data,metadata
         ) values ($1,$2,'organization.owner_invitation.resent',$3::jsonb,$4::jsonb,$5::jsonb)`,
        [
          context.apiClient.id,
          organizationId,
          JSON.stringify({ invitationSentAt: owner.invitationSentAt }),
          JSON.stringify({
            ownerId: owner.id,
            invitationSentAt: sentAt,
            delivery: 'supabase_recovery_email',
          }),
          JSON.stringify(context.auditMetadata),
        ],
      );
      return result;
    });
  }
}
