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

Create a token after applying `0003_platform_api.sql`:

```powershell
npx.cmd --yes pnpm@11.9.0 --filter @ximo/api platform:token:create --name "Main website" --expires-days 365
```

The command prints the token once. The database stores only its SHA-256 hash. Send it as:

```http
Authorization: Bearer ximo_platform_<secret>
```

The website server may include `X-Platform-Actor-Id` and `X-Platform-Actor-Email` so the immutable
platform audit record identifies which signed-in Super Admin initiated a change.

| Method | Route                                                         | Purpose                                      |
| ------ | ------------------------------------------------------------- | -------------------------------------------- |
| GET    | `/platform/plans`                                             | List plans and their included modules        |
| GET    | `/platform/modules`                                           | List the module catalog                      |
| GET    | `/platform/organizations`                                     | Search and paginate organizations            |
| GET    | `/platform/organizations/:organizationId`                     | Organization and subscription details        |
| GET    | `/platform/organizations/:organizationId/modules`             | Plan, override, and effective module states  |
| PATCH  | `/platform/organizations/:organizationId/subscription`        | Change the plan and subscription status      |
| PUT    | `/platform/organizations/:organizationId/modules/:moduleCode` | Set an enabled/disabled module override      |
| DELETE | `/platform/organizations/:organizationId/modules/:moduleCode` | Remove an override and follow the plan again |
| GET    | `/platform/audit`                                             | Paginated platform audit history             |

Module override body:

```json
{
  "enabled": false,
  "reason": "Not included in the client's agreement"
}
```

Subscription body:

```json
{
  "planCode": "business",
  "status": "active",
  "currentPeriodEndsAt": "2027-07-27T00:00:00+08:00"
}
```
