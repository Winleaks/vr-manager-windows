using System.Drawing.Printing;
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
            if (args.Length != 2 || args[0] is not ("share" or "print" or "validate"))
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

    internal static void Reply(string status, string? message = null, int? pages = null)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { protocol = 1, status, message, pages }));
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
    private readonly string operation;
    private readonly string pdfPath;
    private readonly System.Windows.Forms.Timer lifetime = new() { Interval = 600_000 };
    private DataTransferManager? shareManager;
    private bool completed;

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
        Controls.Add(new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Text = "Se pregătește PDF-ul..." });
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
                Program.Reply("validated", pages: (int)pdf.PageCount);
                Close();
                return;
            }
            lifetime.Start();
            if (operation == "share") StartShare(storageFile);
            else await PrintAsync(pdf);
        }
        catch (Exception error)
        {
            completed = true;
            Program.Fail(error);
            Close();
        }
    }

    private void StartShare(StorageFile file)
    {
        Controls[0].Text = "Alege WhatsApp în fereastra Windows Share, apoi contactul.\nPoți închide această fereastră pentru a anula.";
        // Own a real STA window and keep its loop alive during deferred transfers.
        shareManager = DataTransferManagerInterop.GetForWindow(Handle);
        shareManager.DataRequested += (_, args) => {
            try
            {
                args.Request.Data.Properties.Title = Path.GetFileNameWithoutExtension(pdfPath);
                args.Request.Data.RequestedOperation = DataPackageOperation.Copy;
                args.Request.Data.SetStorageItems(new IStorageItem[] { file }, true);
                args.Request.Data.ShareCompleted += (_, _) => {
                    if (!IsDisposed) BeginInvoke((Action)(() => { completed = true; Close(); }));
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
        Controls[0].Text = "Alege imprimanta și paginile în dialogul Windows.";
        Program.Reply("opened");
        if (dialog.ShowDialog(this) != DialogResult.OK) { Close(); return; }
        lifetime.Stop(); // Never time out an already submitted print job.
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
        Controls[0].Text = "Se trimit paginile la imprimantă...";
        await Task.Yield();
        if (IsDisposed) return;
        document.Print();
        completed = true;
        Program.Reply("printed");
        Close();
    }
}
