# Frontend content UI changes

All edits are inside `POS/apps/mobile`. Existing dashboard and sidebar edits were retained. The previously modified `app/(tabs)/_layout.tsx` was left untouched by this task.

## Implemented

- Shared compact headers, sentence-case field labels, neutral empty states, visible web keyboard focus, and reusable disclosure panels that retain mounted form state.
- Dashboard quick access uses the exact existing sidebar permission, module and profile filtering, capped at six links and hidden when fewer than two are allowed. Sales details are secondary; low-stock indicators use amber, and the chart has a flat fill and a retry state.
- Sidebar has direct daily-work links, compact catalog, inventory, register, reports, administration and food-service groups, one expanded group at a time, active-route expansion, and accessible expansion states.
- Products expose status and category controls, contextual catalog links, compact rows, stock/status/edit actions, and expandable secondary details and actions.
- Inventory workflows sit under an Inventory actions disclosure. Existing production navigation is retained.
- POS keeps its existing checkout implementations and uses the split view from 768px upward.
- Sales history adds receipt/cashier/payment search and date presets over loaded receipts, clearly labels the pagination limitation, and retains original receipt and held-sale actions.
- Purchasing tabs wrap at narrow widths and expose accessible selection states.
- Registers and history share two navigation tabs using the existing URLs.
- Product forms now surface the six requested sections—Basic information, Price and tax, Inventory, Variants and selling units, Media and availability, and Advanced settings—while retaining existing wizard validation and submitted fields.
- Organization identifiers and branch lists, plus device-specific hardware settings, are now secondary disclosure panels.
- Settings show unsaved changes in the header. The existing report picker remains and its touch targets are enlarged.

## Files changed by this task

- `app/(tabs)/index.tsx`
- `app/(tabs)/inventory.tsx`
- `app/(tabs)/pos.tsx`
- `app/(tabs)/sales.tsx`
- `app/product-form.tsx`
- `app/organization.tsx`
- `app/hardware.tsx`
- `app/products.tsx`
- `app/purchasing.tsx`
- `app/registers.tsx`
- `app/settings.tsx`
- `app/shift-reports.tsx`
- `src/components/app-sidebar.tsx`
- `src/components/ui.tsx`
- `src/components/quick-access.tsx` (new)
- `src/components/navigation.ui.test.tsx` (new)
- `src/screens/reports-table-workspace.tsx`
- `src/global.css`
- `UI-REDESIGN-NOTES.md` (this report)

## Verification

- Prettier run on edited frontend files.
- Mobile TypeScript check passed.
- Vitest: 23 files, 180 tests passed.
- Jest: two suites, six tests passed, including access filtering, quick-access limits, sidebar disclosure behavior and preservation of mounted form contents.
- Compared formatted TypeScript API/query/mutation calls with HEAD: unchanged in all edited screens, including dashboard.
- Local Expo web bundle succeeded (1,347 modules) and the browser rendered the sign-in screen at http://localhost:8091.
- No backend, shared contract, database, authentication, deployment, store or API files changed.

## Remaining work and limitations

This is a frontend redesign pass, not a claim that every item in the brief has been visually verified.

- An authenticated browser session is needed to inspect dashboard, populated/empty screens, all original actions, and desktop/tablet/mobile content layouts. The available session only reached sign-in; no checkout, return, payment, shift-close or other business write was performed.
- Category filtering and receipt search/date filters operate on already-loaded records. Full-history filtering and completed-sale customer information are not available from the unchanged current screen requests. No API fields or request parameters were added.
- The underlying product wizard still groups context-sensitive inputs into four validation stages. The six named sections are shown in the form and variants remain conditional on the selected inventory setup.
- The active report-table workspace and audit log use compact list rows on phone widths. Older unused report workspace internals still contain wide-table layouts and should be retired or migrated before they are brought back into navigation.
- Physical scanner, tablet hardware, touch keyboard, printing and offline workflows require device verification.

The dev server was started with the canonical uppercase `XIMO` path to avoid a Windows Metro path-case hashing error, with Expo telemetry disabled. No configuration file changes were required.
