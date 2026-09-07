# Invoice catalogue additions

The shared invoice editor (invoice list and client profile) allows Writer to append active catalogue products to issued invoices, including imported invoices. Existing imported item IDs, names, source order links, issuer identity and payments are preserved. New rows use catalogue names/localization/identity from SQLite; quantities and invoice-only price overrides remain editable. Header, rows and audit commit together. Cancelled invoices and invoices with issued credit notes/applied credit remain blocked. No new schema migration is required.

`billing:getInvoiceProducts(invoiceId)` is Writer-only. Main derives the external store ID from the saved invoice and requests `products.invoice_prices` using the existing protected external API credential. The endpoint requires `orders:read`, derives the pricing owner from `client_store`, and calls the existing read-only `get_effective_prices_batch` RPC. This preserves VR Baker's precedence: fixed product price, product percentage discount, category discount, general discount, standard price. Zero is valid; existing invoice rows are never automatically repriced. No preferential pricing settings or source orders are written.

Linked stores require an online verified price response before products can be added. Missing, duplicate, malformed or wrong-store responses are rejected; unavailable pricing is not treated as absence of a preferential tariff. Existing invoice rows remain editable offline. Unlinked local stores/products use the local standard catalogue price. An operator override changes only the invoice, not the platform tariff.

## Activation and checks

Publish the additive `external-api` action before releasing a hub build that uses it. Preserve current deployed source changes and credential scopes during that deployment; do not replace the live function without comparison. No credential rotation or database migration is needed. Publication requires explicit user approval.

Covered locally: pricing/response validation, Viewer denial, imported additions and repeat-save rejection, catalogue identity validation, audit rollback, preserved payments/source identity, typecheck and production build. Browser verification with synthetic IPC fixtures covered adding a £2.50 product, changing its price to £3.25 and quantity to 3, saving a £17.75 invoice, offline failure and Viewer denial. The synthetic browser fixture was removed after verification.

The actual Windows installed-app workflow and deployed HTTP action still need acceptance after authorized publication. Read-only production inspection confirmed the RPC signature/rules and service-role permission; the inspection role cannot execute the RPC, so no live pricing response was asserted. Keep the previous installer for rollback; existing invoices are not automatically modified by the new action.
