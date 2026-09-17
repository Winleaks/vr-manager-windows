# Billing navigation context

The normal billing workspace and each unlocked protected-register session own an
independent, memory-only navigation cache. It contains UI preferences (search,
filters, selected company/tab and scroll offsets), never invoice/company rows,
PINs or other credentials. It does not use SQLite, localStorage, sessionStorage
or Drive. Leaving the workspace/reloading the application resets the cache;
locking the protected register discards its cache for both Writer and Viewer.

Clients retain separate positions for the client list and each profile tab.
Invoice filters survive route/panel changes. Scroll restoration targets the
actual scrolling main element, waits for asynchronously loaded content and
yields when the operator scrolls/interacts. Background invoice/company refreshes
keep the existing rows mounted, and invoice dialogs restore focus without
scrolling their opener into view.

Verification uses synthetic IPC only:

```sh
node scripts/testRendererInputs.mjs
```

`VR_HUB_PLAYWRIGHT_MODULE` can select an existing Playwright installation. The
navigation cases use 80 companies/invoices and delayed reads, exercising profile
return, route/browser Back, tab/filter retention, editor close/save/refetch,
protected Writer/Viewer navigation and clearing preferences on lock/unlock.
The fixture rejects external network requests. No production data or release is
changed. Native Windows interaction remains a manual release check.
