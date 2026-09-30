# Android APK builds

The `apk` EAS profile builds a signed, standalone Ximo POS Android app for direct
installation. It uses the **production** Expo environment and the existing
`com.ximo.pos` application ID and Android signing credentials. It does not publish
to Google Play. The `preview` profile continues to use the development backend.

## Build

From `apps/mobile`, while signed into the Expo account that owns the project:

```powershell
npx --yes eas-cli@21.4.0 build --platform android --profile apk
```

The production Expo environment must contain these public client settings:

- `EXPO_PUBLIC_API_URL`: `https://ximo-pos-api.onrender.com/api/v1`
- `EXPO_PUBLIC_SUPABASE_URL`: production Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`: public anon key for that same project

Never use a Supabase service-role key, PayMongo secret, database password, or other
server credential in an `EXPO_PUBLIC_*` variable. These values are embedded in the
APK. The root `.easignore` excludes local environment files and unrelated projects
from the upload. The post-install hook compiles the shared workspace package.

## Install and test

1. Download the APK from the completed Expo build onto the Android device.
2. If prompted, allow installation from the browser or file manager used to open it.
3. Install Ximo POS and sign in with an existing POS account.
4. Verify the correct branch, product search, cart, and camera barcode scanning.

This app connects to live POS data. Do not complete a real sale merely to test
installation. Expo Go and a computer development server are not required.

Keep the existing Android signing key for future updates. Installing over a build
signed with a different key may fail; do not uninstall an existing POS app without
first checking for unsynced local work.
