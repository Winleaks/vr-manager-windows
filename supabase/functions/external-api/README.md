# VR - Hub Management credential rollout

The deployed function intentionally keeps `verify_jwt=false` because it performs its own `X-API-Key` authentication. Keep the server-side kill switch.

Configure Supabase Edge Function secrets outside source control:

- `EXTERNAL_API_ENABLED=true` only for the controlled rollout window;
- add credential id `vr-hub-management-writer` to `EXTERNAL_API_CREDENTIALS`;
- store only the lowercase SHA-256 hash of a cryptographically random token;
- scopes: `health:read`, `orders:read`, `companies:read`, `stores:read`, `products:read`;
- set an explicit expiry and bounded `rate_limit_per_minute`;
- never add `orders:write` to the desktop credential.

During rotation, add the new hashed credential, verify it from the Writer, then disable the old credential. Paste the raw token only into the desktop settings screen; Electron stores it through `safeStorage`. Do not put the raw token in this repository, SQLite, logs, tickets, or chat.

Before enabling invoice emission, compare a Monday–Sunday preview against SQL aggregates for order count, non-zero line count, and snapshot-price total. The current desktop contract imports only `open` and `locked`; `delivered` stays reserved for the future driver application and `cancelled` is excluded.
