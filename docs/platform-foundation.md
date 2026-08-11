# Ximo multi-product platform foundation

This document describes the architecture introduced by migration
`0032_multi_product_platform_foundation.sql`. It is the starting point for connecting Ximo's
official website, Ximo POS, and future Ximo applications without creating a separate customer
identity or billing database for each product.

## Target architecture

```mermaid
flowchart TB
  Browser["Customer browser"] --> Website["Official Ximo website / account portal"]
  POS["Ximo POS web, iOS and Android"] --> API["Ximo application API"]
  Future["Future Ximo applications"] --> API
  Website -->|"private platform token"| API
  Browser -->|"Supabase session"| Auth["Supabase Auth"]
  POS -->|"same Supabase session"| Auth
  Future -->|"same Supabase session"| Auth
  API --> Auth
  API --> DB["One primary Supabase PostgreSQL database"]
  DB --> Core["Shared identity, organizations, memberships, plans and subscriptions"]
  DB --> Domains["Application-owned domain tables"]
  Domains --> PosDomain["POS products, branches, sales and inventory"]
  Domains --> FutureDomain["Future e-commerce/payroll domains"]
```

This is one **logical primary database**, not one giant shared table. Shared platform tables own
identity, organization membership, plans, subscriptions, and entitlements. Each application still
owns its domain tables. POS sales and inventory remain separate from a future e-commerce order
domain even though both live in the same PostgreSQL system initially.

## Ownership model

| Concept              | Source of truth                                 | Purpose                                                        |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Person/account       | Supabase Auth (`auth.users`)                    | One login across all Ximo applications                         |
| Business/customer    | `organizations`                                 | Tenant, billing, and data boundary                             |
| Person in a business | `organization_memberships`                      | Allows one account to belong to organizations                  |
| Ximo product         | `applications`                                  | Registers Ximo POS and future applications                     |
| Role in one product  | `membership_application_roles`                  | The same person may be a POS cashier and an e-commerce manager |
| Product purchase     | `subscriptions`                                 | One subscription per organization per application              |
| Plan capability      | `application_entitlements`, `plan_entitlements` | Normalized feature/limit values                                |
| Contract exception   | `organization_entitlement_overrides`            | Auditable per-customer entitlement override                    |
| POS compatibility    | `profiles`, `roles`, `modules`, `plan_modules`  | Existing POS behavior during incremental migration             |

## Database relationships

```mermaid
erDiagram
  AUTH_USERS ||--o{ ORGANIZATION_MEMBERSHIPS : joins
  ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERSHIPS : has
  ORGANIZATION_MEMBERSHIPS ||--o{ MEMBERSHIP_APPLICATION_ROLES : receives
  APPLICATIONS ||--o{ MEMBERSHIP_APPLICATION_ROLES : scopes
  ROLES ||--o{ MEMBERSHIP_APPLICATION_ROLES : assigns
  APPLICATIONS ||--o{ PLANS : offers
  APPLICATIONS ||--o{ SUBSCRIPTIONS : scopes
  ORGANIZATIONS ||--o{ SUBSCRIPTIONS : purchases
  PLANS ||--o{ SUBSCRIPTIONS : selected
  APPLICATIONS ||--o{ APPLICATION_ENTITLEMENTS : defines
  PLANS ||--o{ PLAN_ENTITLEMENTS : grants
  APPLICATION_ENTITLEMENTS ||--o{ PLAN_ENTITLEMENTS : configures
  ORGANIZATIONS ||--o{ ORGANIZATION_ENTITLEMENT_OVERRIDES : overrides
```

## What migration 0032 does

1. Registers `ximo_pos` in `applications`.
2. Assigns every existing plan and module to Ximo POS.
3. Changes subscription uniqueness from one per organization to one per organization/application.
4. Backfills every POS profile into `organization_memberships`.
5. Backfills every POS role into `membership_application_roles` for `ximo_pos`.
6. Keeps future POS profile changes synchronized through a compatibility trigger.
7. Converts existing plan modules into boolean application entitlements.
8. Adds RLS for the new catalog and membership tables.
9. Adds `organization_application_access`, a read model for the official account portal.

The migration does not delete or rename existing POS tables. Existing organizations, users,
branches, products, inventory, sales, and reports are preserved.

## Runtime behavior

The normal authenticated POS context still contains `organization`, `role`, `permissions`,
`modules`, and `branches`. It now also contains:

```json
{
  "membership": {
    "id": "membership-uuid",
    "organizationId": "organization-uuid",
    "status": "active"
  },
  "applications": [
    {
      "id": "application-uuid",
      "code": "ximo_pos",
      "name": "Ximo POS",
      "subscriptionStatus": "active",
      "planCode": "business",
      "planName": "Business",
      "role": "owner",
      "entitlements": {
        "module.pos": true,
        "module.products": true,
        "module.reports": true
      }
    }
  ]
}
```

POS module resolution explicitly selects `ximo_pos`. Adding an e-commerce subscription later will
not change POS modules or POS subscription status.

## Official website integration

The browser must never receive a platform token. The flow is:

```mermaid
sequenceDiagram
  participant User as Business owner
  participant Web as Official website
  participant API as Ximo API
  participant Auth as Supabase Auth
  participant DB as PostgreSQL
  User->>Web: Register or sign in
  Web->>Auth: Create/use the global account
  Web->>API: Provision organization (server-to-server token)
  API->>DB: Create organization, POS subscription, role, branch and membership
  API->>Auth: Send owner invitation when onboarding a new account
  API-->>Web: Organization and application access
  User->>Web: Open POS
  Web-->>User: Navigate to POS launch URL
  User->>Auth: Reuse the same account/session
```

Create the server token once:

```powershell
npx.cmd --yes pnpm@11.9.0 --filter @ximo/api platform:token:create --name "Official Ximo website" --expires-days 365
```

Store it as a secret in the website backend, for example `XIMO_PLATFORM_API_TOKEN`. Do not use an
`EXPO_PUBLIC_*`, `NEXT_PUBLIC_*`, or browser-visible variable.

### Platform endpoints

| Method  | Endpoint                                                             | Use                                             |
| ------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| `GET`   | `/api/v1/platform/applications`                                      | Product catalog for the account portal          |
| `GET`   | `/api/v1/platform/plans`                                             | Current Ximo POS plans (compatibility endpoint) |
| `POST`  | `/api/v1/platform/organizations`                                     | Provision a POS customer idempotently           |
| `GET`   | `/api/v1/platform/organizations/:id/applications`                    | Show everything the business purchased          |
| `PATCH` | `/api/v1/platform/organizations/:id/applications/:code/subscription` | Add/change a product subscription               |
| `PATCH` | `/api/v1/platform/organizations/:id/subscription`                    | Ximo POS compatibility alias                    |

Example application-specific subscription request:

```http
PATCH /api/v1/platform/organizations/ORG_ID/applications/ximo_pos/subscription
Authorization: Bearer ximo_platform_SECRET
Content-Type: application/json
X-Platform-Actor-Id: website-admin-user-id

{
  "planCode": "business",
  "status": "active",
  "currentPeriodEndsAt": "2027-08-10T00:00:00+08:00"
}
```

For first-time organization provisioning after website registration, include the signed-in
Supabase user's UUID as `ownerUserId` in `POST /api/v1/platform/organizations`. The server verifies
that its Auth email matches `ownerEmail` and reuses the account. Omitting it retains the invitation
flow for platform staff onboarding a customer who has not registered yet.

## Deployment order

Use this order so no deployed API queries columns that are not available yet:

1. Back up the production Supabase database and test restore procedures.
2. Deploy/apply migrations through `0031` first. Resolve any failed older migration before
   continuing; do not mark it applied manually.
3. Apply `0032_multi_product_platform_foundation.sql`.
4. Verify the backfill queries below.
5. Deploy the updated shared package and Express API.
6. Smoke-test POS login, product list, checkout, reports, and owner onboarding.
7. Configure the official website backend token and call the platform endpoints.
8. Only after that, add a second application and its plans.

For a completely fresh production project, apply migrations `0001` through `0033` in order and
do **not** include `supabase/seed.sql`. Migration `0033` installs only the production reference
catalogue (POS plans, modules, permissions, and entitlements). The development seed additionally
creates a demo organization, branches, products, inventory, and registers and is not appropriate
for a clean production environment.

Verification queries:

```sql
select code, name, is_active from public.applications order by code;

select count(*) as profiles from public.profiles;
select count(*) as memberships from public.organization_memberships;

select o.name, a.code, s.status, p.code as plan_code
from public.subscriptions s
join public.organizations o on o.id = s.organization_id
join public.applications a on a.id = s.application_id
join public.plans p on p.id = s.plan_id
order by o.name, a.code;

select * from public.organization_application_access
order by organization_id, application_code;
```

For the initial backfill, the active/suspended membership count should match the profile count. A
later multi-organization user may create more memberships than legacy POS profiles; that is valid.

## Adding the next Ximo application

Do not create a second customer database. Add one application row, namespaced plans and
entitlements, a server module for its business rules, and domain-specific tables that always carry
`organization_id`.

```sql
insert into public.applications (code, name, description, launch_url)
values ('ximo_ecommerce', 'Ximo E-commerce', 'Online storefront and order management',
        'https://shop.ximo.example');
```

The follow-up application migration should seed its plans and entitlements and add its own RLS
policies. It must not reuse POS tables as a generic dumping ground. Cross-application integration
should use explicit services/events, not direct UI queries across unrelated domain tables.

## Five-year scaling path

- **Now:** one Supabase project and modular Express API; simplest transactional consistency.
- **Growth:** add a transactional outbox and background workers for email, analytics, webhooks, and
  cross-application synchronization.
- **Higher load:** add read replicas/reporting projections and partition large ledgers by time or
  organization when measurements justify it.
- **Service extraction:** only extract a domain after it needs independent scaling or deployment.
  Keep global identity and organization IDs stable and propagate events through an outbox.
- **Disaster recovery:** automated backups, point-in-time recovery, restore drills, and migration
  rehearsals are required before depending on the system for multiple products.

## Deliberate limitations of this phase

- `profiles` is still the active POS compatibility projection and has one row per Auth user. The new
  membership model is ready for multiple organizations, but the POS organization switcher and
  profile projection must be completed before one account actively operates multiple businesses.
- Existing plan and module codes remain globally unique to avoid breaking old clients. New products
  must use namespaced codes until a later catalog migration changes uniqueness to
  `(application_id, code)`.
- The official website backend is not stored in this repository, so its HTTP client must be updated
  in that repository after this API is deployed.
