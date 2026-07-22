using System.Text.Json;
using System.Runtime.InteropServices;

namespace ComputerUse.TestApp;

internal static class Program
{
    private const string TargetTitle = "Anybox Computer Use Test Fixture";
    private const string OccluderTitle = "Anybox Computer Use Test Occluder";
    private const uint MouseEventMove = 0x0001;
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoMove = 0x0002;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpShowWindow = 0x0040;
    private static readonly IntPtr HwndTopmost = new(-1);

    [DllImport("user32.dll")]
    private static extern void mouse_event(
        uint flags,
        int dx,
        int dy,
        uint data,
        UIntPtr extraInfo
    );

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hwnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var options = Options.Parse(args);
        using var form = options.Occluder
            ? CreateOccluder(options)
            : CreateTarget(options);
        form.Shown += (_, _) =>
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                ready = true,
                hwnd = form.Handle.ToInt64().ToString(),
                title = form.Text,
                bounds = new
                {
                    x = form.Bounds.X,
                    y = form.Bounds.Y,
                    width = form.Bounds.Width,
                    height = form.Bounds.Height,
                },
            }));
            Console.Out.Flush();
            if (options.Minimized)
            {
                form.WindowState = FormWindowState.Minimized;
            }
        };
        Application.Run(form);
    }

    private static Form CreateTarget(Options options)
    {
        var form = CreateBaseForm(options.Title ?? TargetTitle, options);
        form.BackColor = Color.FromArgb(10, 24, 48);
        form.AccessibleName = "Anybox Computer Use Test Window";
        form.AccessibleDescription = "Controlled fixture for screenshot, accessibility, and input tests.";

        var header = new Panel
        {
            Name = "HeaderPanel",
            AccessibleName = "Teal test header",
            BackColor = Color.FromArgb(0, 174, 156),
            Dock = DockStyle.Top,
            Height = 82,
            Padding = new Padding(24, 16, 24, 12),
        };
        header.Controls.Add(new Label
        {
            Name = "HeaderLabel",
            AccessibleName = "Fixture heading",
            AutoSize = true,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 18, FontStyle.Bold),
            Text = "ANYBOX COMPUTER USE TEST",
        });

        var left = new Panel
        {
            Name = "BluePanel",
            AccessibleName = "Blue verification panel",
            BackColor = Color.FromArgb(36, 99, 235),
            Dock = DockStyle.Left,
            Width = 238,
            Padding = new Padding(22),
        };
        left.Controls.Add(new Label
        {
            Name = "MarkerLabel",
            AccessibleName = "Screenshot marker",
            AutoSize = true,
            ForeColor = Color.White,
            Font = new Font("Consolas", 13, FontStyle.Bold),
            Text = "WGC-FIXTURE\nBLUE-36-99-235",
        });

        var content = new Panel
        {
            Name = "ContentPanel",
            AccessibleName = "Interactive controls",
            BackColor = Color.FromArgb(245, 247, 250),
            Dock = DockStyle.Fill,
            Padding = new Padding(28, 22, 28, 22),
        };
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = false,
            ColumnCount = 1,
            RowCount = 8,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        layout.Controls.Add(new Label
        {
            AutoSize = true,
            ForeColor = Color.FromArgb(30, 41, 59),
            Font = new Font("Segoe UI", 11, FontStyle.Bold),
            Text = "Editable value",
        });
        var editable = new TextBox
        {
            Name = "EditableValue",
            AccessibleName = "Editable value",
            Dock = DockStyle.Top,
            Text = "fixture-ready",
        };
        layout.Controls.Add(editable);
        layout.Controls.Add(new Label
        {
            AutoSize = true,
            ForeColor = Color.FromArgb(30, 41, 59),
            Text = "Secret value (must never be exposed)",
        });
        layout.Controls.Add(new TextBox
        {
            Name = "SecretValue",
            AccessibleName = "Secret value",
            Dock = DockStyle.Top,
            PasswordChar = '●',
            Text = "do-not-export-this-secret",
        });

        var counter = new Label
        {
            Name = "CounterStatus",
            AccessibleName = "Count: 0",
            AutoSize = true,
            ForeColor = Color.FromArgb(15, 23, 42),
            Font = new Font("Segoe UI", 11, FontStyle.Bold),
            Text = "Count: 0",
        };
        var button = new Button
        {
            Name = "IncrementButton",
            AccessibleName = "Increment counter",
            Dock = DockStyle.Fill,
            Text = "Increment",
            UseVisualStyleBackColor = true,
        };
        var count = 0;
        button.Click += (_, _) =>
        {
            count += 1;
            counter.Text = $"Count: {count}";
            counter.AccessibleName = counter.Text;
        };
        layout.Controls.Add(button);
        layout.Controls.Add(new CheckBox
        {
            Name = "ConsentCheckBox",
            AccessibleName = "Controlled test checkbox",
            AutoSize = true,
            Text = "Controlled test checkbox",
        });
        layout.Controls.Add(counter);
        layout.Controls.Add(new Label
        {
            Name = "FooterMarker",
            AccessibleName = "Fixture footer marker",
            AutoSize = true,
            Anchor = AnchorStyles.Bottom | AnchorStyles.Left,
            ForeColor = Color.FromArgb(202, 48, 79),
            Font = new Font("Consolas", 10, FontStyle.Bold),
            Text = "MAGENTA-MARKER-202-48-79",
        });
        content.Controls.Add(layout);

        if (options.ExtraControls > 0)
        {
            var bulk = new Panel
            {
                Name = "BulkAccessibilityPanel",
                AccessibleName = "Bulk accessibility limit fixture",
                AutoScroll = true,
                BackColor = Color.White,
                Dock = DockStyle.Fill,
            };
            bulk.SuspendLayout();
            for (var index = 0; index < options.ExtraControls; index++)
            {
                bulk.Controls.Add(new Label
                {
                    AccessibleName = $"Bulk node {index:D4}",
                    AutoSize = true,
                    Location = new Point(8, index * 22),
                    Text = $"Bulk node {index:D4}",
                });
            }
            bulk.AutoScrollMinSize = new Size(320, options.ExtraControls * 22 + 20);
            bulk.ResumeLayout(performLayout: false);
            content.Controls.Add(bulk);
            bulk.BringToFront();
        }

        if (options.MutateAfterMs > 0)
        {
            form.Shown += (_, _) =>
            {
                var timer = new System.Windows.Forms.Timer
                {
                    Interval = options.MutateAfterMs,
                };
                timer.Tick += (_, _) =>
                {
                    timer.Stop();
                    counter.Text = "Count: external mutation";
                    counter.AccessibleName = counter.Text;
                    timer.Dispose();
                };
                timer.Start();
            };
        }
        if (options.PointerTakeoverAfterMs > 0)
        {
            form.Shown += (_, _) =>
            {
                var timer = new System.Windows.Forms.Timer
                {
                    Interval = options.PointerTakeoverAfterMs,
                };
                timer.Tick += (_, _) =>
                {
                    timer.Stop();
                    mouse_event(MouseEventMove, 2, 1, 0, UIntPtr.Zero);
                    mouse_event(MouseEventMove, -2, -1, 0, UIntPtr.Zero);
                    timer.Dispose();
                };
                timer.Start();
            };
        }
        if (options.ClipboardTakeover)
        {
            form.Shown += (_, _) =>
            {
                IDataObject? originalClipboard = null;
                var capturedOriginal = false;
                try
                {
                    originalClipboard = Clipboard.GetDataObject();
                    capturedOriginal = true;
                }
                catch
                {
                    // The controlled smoke test still validates sequence handling.
                }
                var poll = new System.Windows.Forms.Timer { Interval = 15 };
                poll.Tick += (_, _) =>
                {
                    string current;
                    try
                    {
                        current = Clipboard.ContainsText()
                            ? Clipboard.GetText(TextDataFormat.UnicodeText)
                            : "";
                    }
                    catch
                    {
                        return;
                    }
                    if (!current.Contains("ANYBOX-CLIPBOARD-TEMP", StringComparison.Ordinal))
                    {
                        return;
                    }
                    poll.Stop();
                    poll.Dispose();
                    const string concurrentValue = "CONTROLLED-CONCURRENT-CLIPBOARD";
                    Clipboard.SetText(concurrentValue, TextDataFormat.UnicodeText);
                    counter.Text = "Clipboard takeover injected";
                    counter.AccessibleName = counter.Text;

                    var verify = new System.Windows.Forms.Timer { Interval = 650 };
                    verify.Tick += (_, _) =>
                    {
                        verify.Stop();
                        verify.Dispose();
                        var preserved = false;
                        try
                        {
                            preserved = Clipboard.ContainsText()
                                && Clipboard.GetText(TextDataFormat.UnicodeText)
                                    == concurrentValue;
                        }
                        catch
                        {
                            // Report failure through the accessibility status label.
                        }
                        counter.Text = preserved
                            ? "Clipboard concurrent value preserved"
                            : "Clipboard concurrent value overwritten";
                        counter.AccessibleName = counter.Text;

                        var restore = new System.Windows.Forms.Timer { Interval = 900 };
                        restore.Tick += (_, _) =>
                        {
                            restore.Stop();
                            restore.Dispose();
                            try
                            {
                                if (capturedOriginal && originalClipboard is not null)
                                {
                                    Clipboard.SetDataObject(originalClipboard, copy: true);
                                }
                                else
                                {
                                    Clipboard.Clear();
                                }
                                counter.Text = "Clipboard original restored";
                            }
                            catch
                            {
                                counter.Text = "Clipboard original restore failed";
                            }
                            counter.AccessibleName = counter.Text;
                        };
                        restore.Start();
                    };
                    verify.Start();
                };
                poll.Start();
            };
        }

        form.Controls.Add(content);
        form.Controls.Add(left);
        form.Controls.Add(header);
        return form;
    }

    private static Form CreateOccluder(Options options)
    {
        var form = CreateBaseForm(OccluderTitle, options);
        form.TopMost = true;
        form.BackColor = Color.FromArgb(255, 0, 170);
        form.AccessibleName = "Computer Use test occluder";
        form.Controls.Add(new Label
        {
            AutoSize = true,
            BackColor = Color.FromArgb(255, 0, 170),
            ForeColor = Color.Black,
            Font = new Font("Segoe UI", 18, FontStyle.Bold),
            Location = new Point(48, 48),
            Text = "OCCLUDER — THIS MUST NOT APPEAR\nIN THE TARGET WGC CAPTURE",
        });
        var keepTopmost = new System.Windows.Forms.Timer { Interval = 15 };
        keepTopmost.Tick += (_, _) =>
        {
            form.TopMost = false;
            form.TopMost = true;
            SetWindowPos(
                form.Handle,
                HwndTopmost,
                0,
                0,
                0,
                0,
                SwpNoSize | SwpNoMove | SwpNoActivate | SwpShowWindow
            );
        };
        form.Shown += (_, _) =>
        {
            form.TopMost = false;
            form.TopMost = true;
            keepTopmost.Start();
            SetWindowPos(
                form.Handle,
                HwndTopmost,
                0,
                0,
                0,
                0,
                SwpNoSize | SwpNoMove | SwpNoActivate | SwpShowWindow
            );
        };
        form.FormClosed += (_, _) =>
        {
            keepTopmost.Stop();
            keepTopmost.Dispose();
        };
        return form;
    }

    private static Form CreateBaseForm(string title, Options options)
    {
        var form = options.Occluder ? (Form)new NoActivateForm() : new Form();
        form.Text = title;
        form.StartPosition = FormStartPosition.Manual;
        form.Location = new Point(options.Left, options.Top);
        form.ClientSize = new Size(options.Width, options.Height);
        form.MinimumSize = new Size(480, 320);
        form.FormBorderStyle = FormBorderStyle.FixedSingle;
        form.MaximizeBox = false;
        return form;
    }

    private sealed record Options(
        bool Occluder,
        bool Minimized,
        string? Title,
        int Left,
        int Top,
        int Width,
        int Height,
        int MutateAfterMs,
        int ExtraControls,
        int PointerTakeoverAfterMs,
        bool ClipboardTakeover
    )
    {
        public static Options Parse(string[] args)
        {
            return new Options(
                Occluder: args.Contains("--occluder", StringComparer.OrdinalIgnoreCase),
                Minimized: args.Contains("--minimized", StringComparer.OrdinalIgnoreCase),
                Title: StringValue(args, "--title"),
                Left: IntValue(args, "--left", 120),
                Top: IntValue(args, "--top", 120),
                Width: IntValue(args, "--width", 720),
                Height: IntValue(args, "--height", 440),
                MutateAfterMs: Math.Clamp(IntValue(args, "--mutate-after-ms", 0), 0, 60_000),
                ExtraControls: Math.Clamp(IntValue(args, "--extra-controls", 0), 0, 3_000),
                PointerTakeoverAfterMs: Math.Clamp(
                    IntValue(args, "--pointer-takeover-after-ms", 0),
                    0,
                    60_000
                ),
                ClipboardTakeover: args.Contains(
                    "--clipboard-takeover",
                    StringComparer.OrdinalIgnoreCase
                )
            );
        }

        private static string? StringValue(string[] args, string key)
        {
            var index = Array.FindIndex(
                args,
                value => string.Equals(value, key, StringComparison.OrdinalIgnoreCase)
            );
            return index >= 0 && index + 1 < args.Length && !string.IsNullOrWhiteSpace(args[index + 1])
                ? args[index + 1]
                : null;
        }

        private static int IntValue(string[] args, string key, int fallback)
        {
            var index = Array.FindIndex(
                args,
                value => string.Equals(value, key, StringComparison.OrdinalIgnoreCase)
            );
            return index >= 0
                && index + 1 < args.Length
                && int.TryParse(args[index + 1], out var value)
                    ? value
                    : fallback;
        }
    }

    private sealed class NoActivateForm : Form
    {
        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                const int wsExNoActivate = 0x08000000;
                var parameters = base.CreateParams;
                parameters.ExStyle |= wsExNoActivate;
                return parameters;
            }
        }
    }
}
