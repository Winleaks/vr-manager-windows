# Native invoice actions

Windows 10 (build 19041+) / Windows 11 x64. This self-contained .NET 8 helper is bundled outside app.asar. The operator does not install .NET separately. Build using the current patched .NET 8 SDK:

```
npm run build:windows-documents
npm run test:windows-documents
```

The release workflow builds and smoke-tests the helper before packaging. The packaging guard refuses a missing/incomplete helper. No database schema changes.

- Share uses an STA message loop, its own HWND, DataTransferManagerInterop and SetStorageItems. `opened` is not treated as proof of attachment. The process stays alive for deferred attachment requests until completion, closure, screen lock, app exit, or ten minutes.
- Print parses and rasterizes the exact saved PDF with Windows.Data.Pdf and uses WinForms PrintDialog/PrintDocument. It does not invoke Electron's PDF viewer or depend on a default PDF reader. Only OK submits a job; cancellation is a separate outcome. Page range, copies, paper and printer settings are handled by the native dialog. Each page is rasterized separately (240 DPI maximum).
- Launch the WinExe with `windowsHide: false`: hiding a process also hides GUI startup windows, not just consoles. The host is shown in the taskbar and activated before print selection. `selecting` means the dialog call is starting, not proof it appeared. `printing` is emitted immediately before submission.
- Main enforces a 30-second startup deadline, then a 2-minute selection deadline and a separate 2-minute submission deadline. An unresponsive helper is terminated; after submission starts, the error warns that pages may already be in the spooler and must be checked before retrying. There is no automatic print retry. Share still needs both `opened` and `attached` before its startup deadline expires.
- Absolute local PDF paths are validated in main and again in the helper. File bytes are bounded and parsed. Filenames are argument-array values, never shell input. The renderer supplies invoice IDs only. Errors report HRESULTs without client paths.
- Smoke mode verifies native host visibility with IsWindowVisible and validates/renders a synthetic PDF without sending or printing. It does not test the printer dialog and cannot replace interactive acceptance on an installed Windows build.

Required installed-Windows acceptance before release: WhatsApp registered as a Share target; invoice with spaces/diacritics; choose contact and cancel; repeat Share without stale sessions; lock during Share; print one and multi-page invoices to Microsoft Print to PDF and a real printer; verify the host/dialog appears above the hub and remains accessible in the taskbar; cancel dialog without error; leave selection open for two minutes and verify the error and re-enabled button; missing default printer; page ranges/copies; verify packaged helper works offline without a system .NET runtime. Keep previous installer for rollback; existing data is unchanged.

Official references:
- https://learn.microsoft.com/en-us/windows/apps/develop/ui/display-ui-objects
- https://learn.microsoft.com/en-us/uwp/api/windows.data.pdf.pdfpage.rendertostreamasync
- https://learn.microsoft.com/en-us/dotnet/desktop/winforms/printing/overview
