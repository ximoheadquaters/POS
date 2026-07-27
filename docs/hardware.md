# Optional POS hardware

Ximo models hardware in two independent layers:

1. The **organization module** is controlled by the trusted Platform API. Hardware modules are not
   included in any subscription plan by default.
2. The **device driver** reports whether a compatible device is ready on the current POS terminal.

Both layers must be ready before Ximo performs a hardware action. A missing or disconnected device
never blocks checkout or reverses a completed sale.

## Module codes

| Module code        | Initial behavior                                                    |
| ------------------ | ------------------------------------------------------------------- |
| `barcode_scanner`  | Supports keyboard-wedge scanners that type a barcode and send Enter |
| `receipt_printer`  | Shows the print action; requires a vendor driver                    |
| `cash_drawer`      | Opens after cash checkout only when its driver reports ready        |
| `payment_terminal` | Reserved for a certified provider terminal driver                   |
| `customer_display` | Sends cart snapshots only when its driver reports ready             |

Apply `supabase/migrations/0006_hardware_modules.sql` before enabling these modules.

## Enable a module

The firm's server-side Super Admin integration calls:

```http
PUT /api/v1/platform/organizations/<organization-id>/modules/receipt_printer
Authorization: Bearer <XIMO_POS_API_TOKEN>
Content-Type: application/json
```

```json
{
  "enabled": true,
  "reason": "Compatible printer installed at the client site"
}
```

Use the same endpoint with `enabled: false` to disable the module. Changes are written to the
immutable platform audit log. POS users can select **More → Hardware devices → Refresh enabled
modules** to load the new effective module state without signing out.

## Add a vendor driver

Device integrations implement the appropriate interface from
`apps/mobile/src/hardware/types.ts` and register it during native app startup:

```ts
registerHardwareDriver('receipt_printer', vendorReceiptPrinter);
```

Vendor Android SDKs require an Expo development build or production build; they cannot be added to
Expo Go. Keep manufacturer-specific imports inside a platform-specific driver so web builds remain
functional.

The payment-terminal driver must use the payment provider's certified SDK. Ximo should receive only
the approval result and transaction reference, never raw card numbers, PINs, or sensitive
authentication data.
