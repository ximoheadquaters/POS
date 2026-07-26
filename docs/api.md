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
