# Demo users

`supabase/seed.sql` intentionally does not insert `auth.users` or passwords. Supabase Auth must hash
and manage credentials.

After `npx supabase db reset`, set unique local values for:

- `DEMO_OWNER_PASSWORD`
- `DEMO_MANAGER_PASSWORD`
- `DEMO_CASHIER_1_PASSWORD`
- `DEMO_CASHIER_2_PASSWORD`

Then run:

```powershell
npx.cmd --yes pnpm@11.9.0 --filter @ximo/api seed:users
```

The script uses the server-only service-role key to:

1. create or reuse each Auth account;
2. insert its profile with the Auth-generated UUID;
3. bind its organization role;
4. replace branch assignments idempotently.

The resulting accounts are:

| Email                        | Role    | Branches         |
| ---------------------------- | ------- | ---------------- |
| `owner@ximo.local`           | Owner   | Bacolod, Talisay |
| `manager@ximo.local`         | Manager | Bacolod, Talisay |
| `cashier.bacolod@ximo.local` | Cashier | Bacolod only     |
| `cashier.talisay@ximo.local` | Cashier | Talisay only     |

Use local-only passwords. For hosted environments, invite named users or create accounts through a
restricted administrator workflow, require password reset/MFA, rotate service keys, and never share
demo accounts.
