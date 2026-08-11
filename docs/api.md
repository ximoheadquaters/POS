# Internal REST API

Base URL: `/api/v1`. All bodies are JSON. Protected requests require
`Authorization: Bearer <supabase-access-token>`.

Success:

```json
{ "success": true, "data": {} }
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Your role cannot perform this action",
    "requestId": "uuid"
  }
}
```

List endpoints use `page` and `pageSize` (maximum 100) and return pagination in `meta`.

## Routes

| Method     | Route                               | Purpose                                                             |
| ---------- | ----------------------------------- | ------------------------------------------------------------------- |
| POST       | `/auth/login`                       | Exchange email/password for Supabase tokens (rate limited)          |
| POST       | `/auth/password-reset`              | Request password reset structure                                    |
| GET        | `/auth/current`                     | Current profile, organization, role, permissions, modules, branches |
| POST       | `/auth/logout`                      | Acknowledge logout; app also clears the Supabase session            |
| GET        | `/organizations/current`            | Business profile and subscription                                   |
| GET, POST  | `/branches`                         | List/create branches                                                |
| PATCH      | `/branches/:id`                     | Update branch                                                       |
| PUT        | `/branches/:branchId/users/:userId` | Assign user to branch                                               |
| GET, PATCH | `/users`, `/users/:id`              | Users, roles, active state, branch assignments                      |
| GET, POST  | `/categories`                       | Categories                                                          |
| GET, POST  | `/products`                         | Paginated search/create                                             |
| PATCH      | `/products/:id`                     | Update and audit product/price                                      |
| GET, POST  | `/products/:id/variants`            | Basic variants and barcodes                                         |
| GET        | `/inventory?branchId=`              | Paginated branch balance                                            |
| GET        | `/inventory/history?branchId=`      | Immutable stock history                                             |
| POST       | `/inventory/adjustments`            | Validated manual adjustment                                         |
| GET, POST  | `/registers`                        | List/create registers                                               |
| POST       | `/registers/shifts/open`            | Open cashier shift                                                  |
| POST       | `/registers/cash-movements`         | Cash in/out                                                         |
| POST       | `/registers/shifts/:id/close`       | Count and close; calculate variance                                 |
| POST       | `/sales/checkout`                   | Atomic sale; requires `Idempotency-Key`                             |
| GET        | `/sales`                            | Filter by dates, branch, cashier, payment method                    |
| GET        | `/sales/:id`                        | Receipt/reprint data                                                |
| POST       | `/returns/sales/:saleId`            | Full or partial return/refund                                       |
| GET, POST  | `/customers`                        | Paginated search/create                                             |
| PATCH      | `/customers/:id`                    | Update customer                                                     |
| GET        | `/customers/:id/history`            | Purchase and return history                                         |
| GET        | `/reports/summary?from=&to=`        | Sales, count, average, methods, products, branches, GP              |
| GET, PUT   | `/settings`                         | Tax, currency, timezone, receipts, inventory, payment methods       |
| GET        | `/audit`                            | Paginated sensitive-action history                                  |

## Checkout contract

`POST /sales/checkout` requires an idempotency key and IDs for a branch, register, open shift, and
items. The API ignores client totals and loads current product/variant prices under an inventory row
lock. Payment `amount` values must exactly equal the final server total. Cash may include a greater
`tendered` value; the difference becomes change. Retrying the same organization/key returns the
original receipt with `replayed: true`.

The error codes most useful to the mobile UI are `BRANCH_ACCESS_DENIED`, `MODULE_DISABLED`,
`PERMISSION_DENIED`, `INSUFFICIENT_INVENTORY`, `PAYMENT_MISMATCH`, `SHIFT_ALREADY_OPEN`,
`INVALID_CHECKOUT_CONTEXT`, and `RETURN_QUANTITY_EXCEEDED`.

## Platform API

The platform API is for a trusted server-side integration such as the firm's existing e-commerce
Super Admin. It uses a separate server-to-server token, not a POS user's Supabase token. Store the
raw token only in the website server environment as `XIMO_POS_API_TOKEN`. Never expose it through
browser JavaScript or a public environment variable.

Create a token after applying the Platform API migrations:

```powershell
npx.cmd --yes pnpm@11.9.0 --filter @ximo/api platform:token:create --name "Main website" --expires-days 365
```

The command prints the token once. The database stores only its SHA-256 hash. Send it as:

```http
Authorization: Bearer ximo_platform_<secret>
```

The website server may include `X-Platform-Actor-Id` and `X-Platform-Actor-Email` so the immutable
platform audit record identifies which signed-in Super Admin initiated a change.

| Method | Route                                                                                | Purpose                                        |
| ------ | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| GET    | `/platform/applications`                                                             | List Ximo applications and subscription counts |
| GET    | `/platform/plans`                                                                    | List plans and their included modules          |
| GET    | `/platform/modules`                                                                  | List the module catalog                        |
| GET    | `/platform/organizations`                                                            | Search and paginate organizations              |
| POST   | `/platform/organizations`                                                            | Provision an organization and invite owner     |
| GET    | `/platform/organizations/:organizationId`                                            | Organization and subscription details          |
| POST   | `/platform/organizations/:organizationId/owner-invitation/resend`                    | Resend owner password setup                    |
| GET    | `/platform/organizations/:organizationId/modules`                                    | Plan, override, and effective module states    |
| PATCH  | `/platform/organizations/:organizationId/subscription`                               | Change the plan and subscription status        |
| GET    | `/platform/organizations/:organizationId/applications`                               | List purchased applications and entitlements   |
| PATCH  | `/platform/organizations/:organizationId/applications/:applicationCode/subscription` | Change one application's subscription          |
| PUT    | `/platform/organizations/:organizationId/modules/:moduleCode`                        | Set an enabled/disabled module override        |
| DELETE | `/platform/organizations/:organizationId/modules/:moduleCode`                        | Remove an override and follow the plan again   |
| GET    | `/platform/audit`                                                                    | Paginated platform audit history               |

### Organization provisioning

`POST /platform/organizations` requires an `Idempotency-Key` header containing 8–200 characters:

```json
{
  "name": "New Client Business",
  "currency": "PHP",
  "timezone": "Asia/Manila",
  "planCode": "business",
  "subscriptionStatus": "active",
  "ownerUserId": "existing-supabase-auth-user-uuid",
  "ownerEmail": "owner@example.com",
  "ownerName": "Client Owner"
}
```

When the owner has already registered and signed in on the official Ximo website, its trusted
backend must include `ownerUserId` from that Supabase session. The API verifies that Auth user and
email match and links the existing account; it does not send a second invitation. Omit
`ownerUserId` only when Ximo should create/invite a brand-new owner account.

The first successful request returns `201`. An identical retry returns `200`, the original response,
and `Idempotent-Replayed: true`. Reusing the key with changed details returns `409`.

Provisioning creates the organization, subscription, settings, system roles and permissions, owner
profile, Main Branch, and Main Counter in one PostgreSQL transaction. Plan modules remain plan
defaults; onboarding does not insert `organization_modules` overrides. Supabase Auth invitation is
an external operation. If the database transaction fails after invitation, the API compensates by
deleting the invited Auth user.

The server-only `PLATFORM_OWNER_INVITE_REDIRECT_URL` controls where Supabase sends the owner after
accepting the email invitation. It is required by the API. Production must use the deployed HTTPS
POS web route ending in `/accept-invitation`; local web development can use
`http://localhost:8081/accept-invitation`.

`POST /platform/organizations/:organizationId/owner-invitation/resend` requires `platform:write`
and returns `202` when Supabase accepts the email. Because Supabase cannot invite an existing Auth
user twice, resends use Supabase's password-recovery email with the same secure password-setup
route. The existing Auth user and POS profile are never deleted or duplicated. A database-backed
five-minute per-owner cooldown returns `429 OWNER_INVITATION_RATE_LIMITED` for repeated requests.

Organization details include safe owner metadata: email, display name, invitation status, invited
or created timestamp, and last sign-in timestamp when Supabase Auth is available. Passwords,
tokens, service-role credentials, and generated invitation URLs are never returned.

See [Owner invitations](owner-invitations.md) for the complete Supabase dashboard and deployment
configuration.

Module override body:

```json
{
  "enabled": false,
  "reason": "Not included in the client's agreement"
}
```

Hardware modules introduced by migration `0006_hardware_modules.sql` are `barcode_scanner`,
`receipt_printer`, `cash_drawer`, `payment_terminal`, and `customer_display`. They are excluded from
all plans by default and are enabled per organization with the same module override endpoint. See
[Optional POS hardware](hardware.md) for the device-driver safety model.

Subscription body:

```json
{
  "planCode": "business",
  "status": "active",
  "currentPeriodEndsAt": "2027-07-27T00:00:00+08:00"
}
```
