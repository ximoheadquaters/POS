# POS owner invitations

## Supabase dashboard configuration

Open **Authentication → URL Configuration** in the POS Supabase project.

Set these values:

- **Site URL:** `https://YOUR_POS_WEB_DOMAIN`
- **Redirect URL (local):** `http://localhost:8081/accept-invitation`
- **Redirect URL (production):** `https://YOUR_POS_WEB_DOMAIN/accept-invitation`
- **Redirect URL (native scheme):** `ximopos://accept-invitation`

Replace `YOUR_POS_WEB_DOMAIN` with the deployed Expo web host. The API's production
`PLATFORM_OWNER_INVITE_REDIRECT_URL` must exactly match the production redirect URL. Use the HTTPS
web URL for invitation emails unless verified universal/app links are configured; the custom
`ximopos` scheme is an additional native option, not the only email destination.

Under **Authentication → Email Templates**, keep both the **Invite user** and **Reset password**
templates enabled and ensure their action points to `{{ .ConfirmationURL }}`. Initial invitations
use Supabase Invite User. Resends use Reset Password because Supabase does not re-invite an existing
Auth user.

Configure production SMTP under **Project Settings → Authentication → SMTP Settings**. Without
production SMTP, delivery is subject to Supabase's development email restrictions and limits.

These dashboard and SMTP changes are external settings and cannot be applied from this repository.

## Environment variables

API-only:

```env
PLATFORM_OWNER_INVITE_REDIRECT_URL=http://localhost:8081/accept-invitation
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

For production, replace the redirect with:

```env
PLATFORM_OWNER_INVITE_REDIRECT_URL=https://YOUR_POS_WEB_DOMAIN/accept-invitation
```

POS application public configuration:

```env
EXPO_PUBLIC_API_URL=https://YOUR_API_DOMAIN/api/v1
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Never add `SUPABASE_SERVICE_ROLE_KEY` to an `EXPO_PUBLIC_*` variable or any browser/mobile code.

## Local testing

Apply migrations through `0005_owner_invitations.sql`, then run these in separate terminals:

```powershell
npx.cmd --yes pnpm@11.9.0 --filter @ximo/api dev
npx.cmd --yes pnpm@11.9.0 --filter @ximo/mobile start -- --web --clear
```

The mobile command starts Expo web at `http://localhost:8081`. Provision a new organization using
the Platform API and open the received email link in the same browser. To check native route
delivery in a development build:

```powershell
npx.cmd uri-scheme open "ximopos://accept-invitation?code=TEST_CODE" --ios
```

A real Supabase callback is still required for successful session establishment; this example only
checks route delivery.

Run automated checks with:

```powershell
npx.cmd --yes pnpm@11.9.0 --filter @ximo/mobile test
npx.cmd --yes pnpm@11.9.0 --filter @ximo/api test
npx.cmd --yes pnpm@11.9.0 typecheck
npx.cmd --yes pnpm@11.9.0 lint
```

## Deployment

1. Apply `0004_platform_provisioning.sql` and `0005_owner_invitations.sql` to the POS Supabase
   database.
2. Deploy Expo web with the `/accept-invitation` route available over HTTPS. Configure the web
   host's SPA fallback/rewrite so `/accept-invitation` serves `index.html`; do not rely on the root
   URL alone.
3. Add the production web and native redirect URLs to Supabase Authentication URL Configuration.
4. Set the API's `PLATFORM_OWNER_INVITE_REDIRECT_URL` to the deployed HTTPS route.
5. Configure Supabase production SMTP and verify both Invite User and Reset Password emails.
6. Deploy the Express API.
7. Build and distribute the native POS apps. Keep `ximopos` as the Expo scheme.
8. Provision a test organization with a unique real email, complete password setup, verify
   `/branch-select`, and then test the resend endpoint after its five-minute cooldown.

The password-setup page explicitly handles PKCE `code`, implicit access/refresh token, and
`token_hash` callback formats. Callback credentials are never logged. Native sessions remain in
SecureStore; Expo web uses browser storage. `detectSessionInUrl` remains disabled so callbacks are
processed only by the invitation route.
