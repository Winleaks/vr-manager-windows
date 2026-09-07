using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Text.Json;
using Windows.ApplicationModel.DataTransfer;
using Windows.Data.Pdf;
using Windows.Storage;
using Windows.Storage.Streams;

// Private, versioned JSON-lines protocol over redirected stdio. No shell commands.
internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        try
        {
            if (args.Length != 2 || args[0] is not ("share" or "print" or "validate" or "validate-preview" or "validate-share"))
                throw new ArgumentException("Invalid document operation.");
            var pdfPath = ValidatePath(args[1]);
            using var form = new DocumentWindow(args[0], pdfPath);
            Application.Run(form);
        }
        catch (Exception error) { Fail(error); }
    }

    internal static string ValidatePath(string value)
    {
        if (!Path.IsPathFullyQualified(value) || value.StartsWith(@"\\") || !value.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Este permis numai un PDF local cu o cale absolută.");
        var path = Path.GetFullPath(value);
        using var file = File.OpenRead(path);
        if (file.Length < 5 || file.Length > 25 * 1024 * 1024)
            throw new ArgumentException("Dimensiunea PDF-ului nu este validă.");
        Span<byte> magic = stackalloc byte[5];
        file.ReadExactly(magic);
        if (!magic.SequenceEqual("%PDF-"u8)) throw new ArgumentException("Fișierul nu este un PDF valid.");
        return path;
    }

    internal static void Reply(string status, string? message = null, int? pages = null, bool? windowVisible = null)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { protocol = 1, status, message, pages, windowVisible }));
        Console.Out.Flush();
    }

    internal static void Fail(Exception error)
    {
        // Report the HRESULT, not document paths or client information.
        Reply("error", $"Operația Windows a eșuat (0x{error.HResult:X8}).");
        Environment.ExitCode = 1;
    }
}

internal sealed class DocumentWindow : Form
{
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    private readonly string operation;
    private readonly string pdfPath;
    private readonly System.Windows.Forms.Timer lifetime = new() { Interval = 600_000 };
    private DataTransferManager? shareManager;
    private DataPackage? sharePackage;
    private bool completed;
    private readonly Label statusLabel = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Text = "Se pregătește PDF-ul..." };

    internal DocumentWindow(string operation, string pdfPath)
    {
        this.operation = operation;
        this.pdfPath = pdfPath;
        Text = operation == "share" ? "Trimite factura — VR Hub" : "Printează factura — VR Hub";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(440, 110);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        Controls.Add(statusLabel);
        Shown += async (_, _) => await StartAsync();
        lifetime.Tick += (_, _) => Close();
        FormClosed += (_, _) => {
            lifetime.Stop();
            lifetime.Dispose();
            if (!completed) Program.Reply("canceled");
        };
    }

    private async Task StartAsync()
    {
        try
        {
            var storageFile = await StorageFile.GetFileFromPathAsync(pdfPath);
            // Parse before either native dialog; a file extension is insufficient.
            var pdf = await PdfDocument.LoadFromFileAsync(storageFile);
            if (IsDisposed) return;
            if (pdf.PageCount == 0 || pdf.PageCount > 500) throw new InvalidDataException("Invalid PDF page count.");
            if (operation == "validate")
            {
                using var firstPage = await RenderPageAsync(pdf, 0);
                completed = true;
                Program.Reply("validated", pages: (int)pdf.PageCount, windowVisible: IsWindowVisible(Handle));
                Close();
                return;
            }
            lifetime.Start();
            if (operation == "validate-share")
            {
                var package = new DataPackage();
                PrepareSharePackage(package, storageFile);
                var view = package.GetView();
                var items = await view.GetStorageItemsAsync();
                if (items.Count != 1 || items[0] is not StorageFile attachment || attachment.Name != Path.GetFileName(pdfPath)
                    || !view.Properties.FileTypes.Contains(".pdf") || view.Contains(StandardDataFormats.Text))
                    throw new InvalidDataException("Invalid PDF attachment package.");
                var buffer = await FileIO.ReadBufferAsync(attachment);
                using var reader = DataReader.FromBuffer(buffer);
                var bytes = new byte[buffer.Length];
                reader.ReadBytes(bytes);
                if (!bytes.SequenceEqual(File.ReadAllBytes(pdfPath))) throw new InvalidDataException("Attachment bytes differ.");
                completed = true;
                Program.Reply("share-validated", pages: (int)pdf.PageCount, windowVisible: IsWindowVisible(Handle));
                Close();
                return;
            }
            if (operation == "share") StartShare(storageFile);
            else await ShowPrintPreviewAsync(pdf);
        }
        catch (Exception error)
        {
            completed = true;
            Program.Fail(error);
            Close();
        }
    }

    private static void PrepareSharePackage(DataPackage package, StorageFile file)
    {
        package.Properties.Title = Path.GetFileNameWithoutExtension(file.Name);
        package.Properties.FileTypes.Add(".pdf");
        package.RequestedOperation = DataPackageOperation.Copy;
        // Electron supplies a disposable, verified local snapshot, never the
        // working invoice. Avoid a read-only broker representation for targets.
        package.SetStorageItems(new IStorageItem[] { file }, false);
    }

    private void StartShare(StorageFile file)
    {
        ClientSize = new Size(540, 170);
        statusLabel.Text = "Alege WhatsApp, apoi contactul și verifică atașamentul PDF.\nPăstrează această fereastră deschisă până ai trimis factura.\nSe închide automat după 10 minute.";
        var done = new Button { Text = "Am terminat în WhatsApp — închide", Dock = DockStyle.Bottom, Height = 36 };
        done.Click += (_, _) => Close();
        Controls.Add(done);
        // Own a real STA window and keep its loop alive during deferred transfers.
        shareManager = DataTransferManagerInterop.GetForWindow(Handle);
        shareManager.DataRequested += (_, args) => {
            try
            {
                sharePackage = args.Request.Data;
                PrepareSharePackage(sharePackage, file);
                sharePackage.ShareCompleted += (_, _) => {
                    // Handoff to a target is not its network upload to a recipient.
                    // Do not dispose the source while WhatsApp may still read it.
                    if (!IsDisposed) BeginInvoke((Action)(() => {
                        completed = true;
                        statusLabel.Text = "PDF-ul a fost predat aplicației selectate.\nVerifică atașamentul și finalizează trimiterea în WhatsApp.\nÎnchide această fereastră după trimitere (maximum 10 minute).";
                    }));
                };
                Program.Reply("attached");
            }
            catch (Exception error)
            {
                args.Request.FailWithDisplayText("PDF-ul nu a putut fi atașat.");
                Program.Fail(error);
                if (!IsDisposed) BeginInvoke((Action)Close);
            }
        };
        DataTransferManagerInterop.ShowShareUIForWindow(Handle);
        Program.Reply("opened");
    }

    private async Task ShowPrintPreviewAsync(PdfDocument pdf)
    {
        Text = $"Previzualizare — {Path.GetFileNameWithoutExtension(pdfPath)} — VR Hub";
        FormBorderStyle = FormBorderStyle.Sizable;
        MaximizeBox = true;
        MinimumSize = new Size(580, 420);
        var area = Screen.FromControl(this).WorkingArea;
        ClientSize = new Size(Math.Min(960, area.Width - 60), Math.Min(820, area.Height - 80));
        CenterToScreen();
        Controls.Clear();
        var image = new PictureBox { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.FromArgb(225, 228, 233), AccessibleName = "Pagina facturii" };
        var toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(8), WrapContents = true };
        var previous = new Button { Text = "◀ Anterior", AutoSize = true, Enabled = false };
        var next = new Button { Text = "Următor ▶", AutoSize = true, Enabled = false };
        var pageLabel = new Label { AutoSize = true, Margin = new Padding(12, 8, 12, 0) };
        var print = new Button { Text = "Alege imprimanta…", AutoSize = true, Enabled = false };
        var cancel = new Button { Text = "Renunță", AutoSize = true };
        toolbar.Controls.AddRange(new Control[] { previous, pageLabel, next, print, cancel });
        statusLabel.Dock = DockStyle.Bottom;
        statusLabel.Height = 48;
        Controls.Add(image);
        Controls.Add(statusLabel);
        Controls.Add(toolbar);
        CancelButton = cancel;
        cancel.Click += (_, _) => Close();
        FormClosed += (_, _) => { image.Image?.Dispose(); image.Image = null; };
        uint currentPage = 0;
        bool busy = false;
        bool choosingPrinter = false;

        async Task ShowPageAsync(uint index)
        {
            if (busy || choosingPrinter || IsDisposed || index >= pdf.PageCount) return;
            busy = true;
            previous.Enabled = next.Enabled = print.Enabled = false;
            try
            {
                var bitmap = await RenderPageAsync(pdf, index);
                if (IsDisposed) { bitmap.Dispose(); return; }
                var old = image.Image;
                image.Image = bitmap;
                old?.Dispose();
                currentPage = index;
                pageLabel.Text = $"Pagina {index + 1} din {pdf.PageCount}";
                statusLabel.Text = "Acesta este PDF-ul facturii. Verifică paginile, apoi alege imprimanta.\nDialogul Windows poate să nu afișeze o previzualizare proprie.";
            }
            catch (Exception error) { completed = true; Program.Fail(error); Close(); }
            finally
            {
                busy = false;
                if (!IsDisposed)
                {
                    previous.Enabled = currentPage > 0;
                    next.Enabled = currentPage + 1 < pdf.PageCount;
                    print.Enabled = image.Image is not null;
                }
            }
        }

        previous.Click += async (_, _) => { if (currentPage > 0) await ShowPageAsync(currentPage - 1); };
        next.Click += async (_, _) => await ShowPageAsync(currentPage + 1);
        print.Click += async (_, _) => {
            if (busy || choosingPrinter || image.Image is null) return;
            choosingPrinter = true;
            toolbar.Enabled = false;
            try { await PrintAsync(pdf); }
            catch (Exception error) { completed = true; Program.Fail(error); Close(); }
        };
        await ShowPageAsync(0);
        if (IsDisposed || image.Image is null) return;
        cancel.Focus(); // Enter must not submit a print job by default.
        Program.Reply("previewing", pages: (int)pdf.PageCount, windowVisible: IsWindowVisible(Handle));
        if (operation == "validate-preview")
        {
            // Exercise the real preview and page navigation without opening a
            // printer dialog, contacting a printer, or creating a spool job.
            await ShowPageAsync(pdf.PageCount - 1);
            if (IsDisposed) return;
            if (image.Image is null || currentPage != pdf.PageCount - 1) throw new InvalidDataException("Preview page unavailable.");
            await ShowPageAsync(0);
            if (IsDisposed) return;
            if (image.Image is null || currentPage != 0 || !image.Visible || !print.Enabled) throw new InvalidDataException("Preview unavailable.");
            completed = true;
            Program.Reply("preview-validated", pages: (int)pdf.PageCount, windowVisible: IsWindowVisible(Handle));
            Close();
        }
    }

    private static async Task<Bitmap> RenderPageAsync(PdfDocument pdf, uint pageIndex)
    {
        using var page = pdf.GetPage(pageIndex);
        using var stream = new InMemoryRandomAccessStream();
        // 240 DPI for invoices, with a bound on pathological page sizes.
        var scale = Math.Min(2.5, 3500 / Math.Max(page.Size.Width, page.Size.Height));
        await page.RenderToStreamAsync(stream, new PdfPageRenderOptions {
            DestinationWidth = Math.Max(1u, (uint)Math.Ceiling(page.Size.Width * scale)),
            DestinationHeight = Math.Max(1u, (uint)Math.Ceiling(page.Size.Height * scale)),
        });
        stream.Seek(0);
        using var reader = new DataReader(stream.GetInputStreamAt(0));
        var length = checked((uint)stream.Size);
        await reader.LoadAsync(length);
        var bytes = new byte[length];
        reader.ReadBytes(bytes);
        using var memory = new MemoryStream(bytes);
        using var image = Image.FromStream(memory);
        return new Bitmap(image);
    }

    private async Task PrintAsync(PdfDocument pdf)
    {
        using var document = new PrintDocument {
            DocumentName = Path.GetFileNameWithoutExtension(pdfPath),
            PrintController = new StandardPrintController(),
        };
        document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
        document.PrinterSettings.MinimumPage = 1;
        document.PrinterSettings.MaximumPage = (int)pdf.PageCount;
        document.PrinterSettings.FromPage = 1;
        document.PrinterSettings.ToPage = (int)pdf.PageCount;
        using var dialog = new PrintDialog {
            Document = document, UseEXDialog = true, AllowSomePages = true,
            AllowSelection = false, AllowCurrentPage = false,
        };
        statusLabel.Text = "Alege imprimanta și paginile în dialogul Windows.";
        BringToFront();
        Activate();
        // This marks selection starting, not proof that the OS dialog opened.
        Program.Reply("selecting");
        if (dialog.ShowDialog(this) != DialogResult.OK) { Close(); return; }
        lifetime.Stop(); // Main owns the submission watchdog; closure must not report cancellation after submission.
        var first = document.PrinterSettings.PrintRange == PrintRange.SomePages ? document.PrinterSettings.FromPage : 1;
        var last = document.PrinterSettings.PrintRange == PrintRange.SomePages ? document.PrinterSettings.ToPage : (int)pdf.PageCount;
        if (first < 1 || last < first || last > pdf.PageCount) throw new InvalidDataException("Invalid page range.");
        var index = first - 1;
        // Render one page at a time off the STA thread. No Chromium PDF plugin.
        document.PrintPage += (_, e) => {
            using var bitmap = Task.Run(() => RenderPageAsync(pdf, (uint)index)).GetAwaiter().GetResult();
            var graphics = e.Graphics ?? throw new InvalidOperationException("Printer graphics unavailable.");
            var area = e.PageSettings.PrintableArea;
            var factor = Math.Min(area.Width / bitmap.Width, area.Height / bitmap.Height);
            var width = bitmap.Width * factor;
            var height = bitmap.Height * factor;
            graphics.DrawImage(bitmap, area.X - e.PageSettings.HardMarginX + (area.Width - width) / 2,
                area.Y - e.PageSettings.HardMarginY + (area.Height - height) / 2, width, height);
            e.HasMorePages = ++index < last;
        };
        statusLabel.Text = "Se trimit paginile la imprimantă...";
        await Task.Yield();
        if (IsDisposed) return;
        Program.Reply("printing");
        document.Print();
        completed = true;
        Program.Reply("printed");
        Close();
    }
}
