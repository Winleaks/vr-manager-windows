# Native invoice actions

Windows 10 (build 19041+) / Windows 11 x64. This self-contained .NET 8 helper is bundled outside app.asar. The operator does not install .NET separately. Build using the current patched .NET 8 SDK:

```
npm run build:windows-documents
npm run test:windows-documents
```

The release workflow builds and smoke-tests the helper before packaging. The packaging guard refuses a missing/incomplete helper. No database schema changes.

- Share uses an STA message loop, its own HWND, DataTransferManagerInterop and SetStorageItems with a verified disposable local PDF snapshot and explicit PDF metadata. The original invoice is never writable by the target. `opened` is not treated as proof of attachment, and preparation is not recipient delivery. The process and snapshot stay available even after ShareCompleted, until explicit closure, screen lock, app exit, or ten minutes. Stale owned snapshots are cleaned on startup.
- Print first displays the exact saved PDF in the hub's native preview window, with first/previous/next-page rendering and aspect-ratio-preserving fit. Only one page bitmap is retained. The operator explicitly chooses the printer after inspecting the PDF; this is separate from the Windows print-dialog preview pane (which can still report that preview is unsupported). Preview does not simulate paper size, orientation or printer margins.
- Print parses and rasterizes that same PDF with Windows.Data.Pdf and uses WinForms PrintDialog/PrintDocument. It does not invoke Electron's PDF viewer or depend on a default PDF reader. Only OK submits a job; cancellation is a separate outcome. Page range, copies, paper and printer settings are handled by the native dialog. Each page is rasterized separately (240 DPI maximum).
- Launch the WinExe with `windowsHide: false`: hiding a process also hides GUI startup windows, not just consoles. The host is shown in the taskbar and activated before print selection. `selecting` means the dialog call is starting, not proof it appeared. `printing` is emitted immediately before submission.
- Main enforces a 30-second startup deadline, a 5-minute PDF preview deadline, then a 2-minute printer-selection deadline and a separate 2-minute submission deadline. Repeated preview events do not extend deadlines or claim printing succeeded. An unresponsive helper is terminated; after submission starts, the error warns that pages may already be in the spooler and must be checked before retrying. There is no automatic print retry. Share still needs both `opened` and `attached` before its startup deadline expires.
- Absolute local PDF paths are validated in main and again in the helper. File bytes are bounded and parsed. Filenames are argument-array values, never shell input. The renderer supplies invoice IDs only. Errors report HRESULTs without client paths.
- Smoke modes verify native host visibility with IsWindowVisible, validate/render a synthetic PDF, and exercise the actual preview from first page to last and back. `validate-preview` never opens a printer dialog or submits a job. `validate-share` reads the StorageItems package back and verifies the PDF name, metadata and bytes without opening Share or sending to a target. These checks cannot replace interactive acceptance on an installed Windows build.

Required installed-Windows acceptance before release: WhatsApp registered as a Share target; invoice with spaces/diacritics; choose contact and cancel; repeat Share without stale sessions; lock during Share; print one and multi-page invoices to Microsoft Print to PDF and a real printer; verify the host/dialog appears above the hub and remains accessible in the taskbar; cancel dialog without error; leave selection open for two minutes and verify the error and re-enabled button; missing default printer; page ranges/copies; verify packaged helper works offline without a system .NET runtime. Keep previous installer for rollback; existing data is unchanged.

Official references:
- https://learn.microsoft.com/en-us/windows/apps/develop/ui/display-ui-objects
- https://learn.microsoft.com/en-us/uwp/api/windows.data.pdf.pdfpage.rendertostreamasync
- https://learn.microsoft.com/en-us/dotnet/desktop/winforms/printing/overview
