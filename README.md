# Ximo POS

Ximo POS is a multi-tenant, multi-branch retail POS SaaS foundation. It contains an Expo/React
Native cashier application, a modular Express API, shared Zod contracts, PostgreSQL migrations,
Supabase authentication/storage integration, development data, and automated authorization and
transaction tests.

## Prerequisites

- Node.js 22 or later with `npm.cmd`/`npx.cmd` available
- Docker Desktop
- Supabase CLI (run it through `npx` in the commands below)
- Expo Go on a physical iPhone or Android device, or a supported simulator/emulator

## Local setup

1. Install packages and create the local environment file:

   ```powershell
   npx.cmd --yes pnpm@11.9.0 install --frozen-lockfile
   Copy-Item .env.example .env
   ```

2. Start local Supabase and apply migrations plus structural seed data:

   ```powershell
   npx supabase start
   npx supabase db reset
   npx supabase status
   ```

3. Copy the local API URL, anon key, service-role key, and PostgreSQL connection string printed by
   `supabase status` into `.env`. Set four unique 12+ character `DEMO_*_PASSWORD` values. Never put a
   real or shared password in source control.

4. Create the four Auth accounts and safely bind their generated UUIDs to the seeded profiles:

   ```powershell
   npx.cmd --yes pnpm@11.9.0 --filter @ximo/api seed:users
   ```

5. Start the API:

   ```powershell
   npx.cmd --yes pnpm@11.9.0 dev:api
   ```

6. In another terminal, set `EXPO_PUBLIC_API_URL` to a URL reachable by the device. Android Emulator
   uses `http://10.0.2.2:4000/api/v1`; an iPhone or other physical phone uses the computer's LAN IP.
   The mobile script loads these values from the root `.env`. Start Expo, clearing Metro's cache
   after installs or SDK changes:

   ```powershell
   npx.cmd --yes pnpm@11.9.0 --filter @ximo/mobile start -- --clear
   ```

The seeded emails are `owner@ximo.local`, `manager@ximo.local`,
`cashier.bacolod@ximo.local`, and `cashier.talisay@ximo.local`. Their passwords are only the values
you supplied in `.env`.

## Quality commands

```powershell
npx.cmd --yes pnpm@11.9.0 format:check
npx.cmd --yes pnpm@11.9.0 lint
npx.cmd --yes pnpm@11.9.0 typecheck
npx.cmd --yes pnpm@11.9.0 test
npx.cmd --yes pnpm@11.9.0 build
```

To reset local data, use `npx supabase db reset`, then rerun the secure user seed command.

## Super Admin website integration

After applying the migrations, issue a server-to-server token for the firm's website backend:

```powershell
npx.cmd --yes pnpm@11.9.0 --filter @ximo/api platform:token:create --name "Main website" --expires-days 365
```

Save the printed value as `XIMO_POS_API_TOKEN` only in the website server environment. The website
server calls `/api/v1/platform`; the token must never be included in a browser bundle. See
[api.md](docs/api.md#platform-api) for endpoint contracts.

## Workspaces

- `apps/mobile` — Expo Router iOS/Android phone and tablet application
- `apps/api` — Express REST API and PostgreSQL domain services
- `packages/shared` — types, constants, roles, permissions, Zod schemas, and exact money helpers
- `supabase/migrations` — schema, constraints, indexes, RLS, and storage policy
- `supabase/seed.sql` — non-secret plans, modules, demo organization, branches, products, inventory,
  and registers
- `docs` — architecture, database, API, user provisioning, and feature status

## Security model

The mobile application receives only the Supabase URL and anon key. It stores the user session with
Expo SecureStore. Every protected API request is verified against Supabase Auth; the API then
derives organization, role, permission, module, and branch context from PostgreSQL. Client-provided
`organization_id` values are never accepted. The service-role key and database credentials are
server-only.

Read [architecture.md](docs/architecture.md), [database.md](docs/database.md),
[api.md](docs/api.md), [demo-users.md](docs/demo-users.md), and
[features.md](docs/features.md) for details.
