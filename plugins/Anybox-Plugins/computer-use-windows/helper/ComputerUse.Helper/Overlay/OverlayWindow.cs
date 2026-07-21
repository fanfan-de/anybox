using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Runtime.InteropServices;
using ComputerUse.Helper.Windows;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper.Overlay;

internal sealed record OverlayWindowStatus(
    string Hwnd,
    Rect Bounds,
    bool Visible,
    bool Topmost,
    bool NoActivate,
    bool MouseTransparent,
    bool ToolWindow,
    bool CaptureExcluded,
    string Theme
);

internal sealed record OverlayPillLayout(
    Rectangle Bounds,
    Rectangle StatusBounds,
    Rectangle SeparatorBounds,
    Rectangle CancelBounds,
    int CornerRadius
);

internal sealed class OverlayWindow : Form
{
    private const int WmNcHitTest = 0x0084;
    private const int WmMouseActivate = 0x0021;
    private const int WmDisplayChange = 0x007E;
    private const int HtTransparent = -1;
    private const int MaNoActivate = 3;
    private const int AnimationFrameMilliseconds = 40;
    private const double BorderPulseMilliseconds = 1520d;
    private const double TextShimmerMilliseconds = 920d;
    private static readonly Color TransparencyColor = Color.FromArgb(0xFF, 0x00, 0xFF);

    private readonly Action _displayChanged;
    private readonly System.Windows.Forms.Timer _animationTimer;
    private readonly Stopwatch _visualClock = new();
    private OverlayPalette _palette;
    private Rectangle _lastPillBounds;
    private bool _captureExcluded;
    private IntPtr _registeredHandle;

    public OverlayWindow(Screen screen, Action displayChanged)
    {
        _displayChanged = displayChanged;
        _palette = OverlayPalette.Current();
        _animationTimer = new System.Windows.Forms.Timer
        {
            Interval = AnimationFrameMilliseconds,
        };
        _animationTimer.Tick += (_, _) => InvalidateAnimatedRegions();
        SetStyle(
            ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.UserPaint,
            true
        );
        AutoScaleMode = AutoScaleMode.None;
        BackColor = TransparencyColor;
        TransparencyKey = TransparencyColor;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        Text = "Anybox Computer Use Safety Overlay";
        Bounds = screen.Bounds;
        DpiChanged += (_, _) => _displayChanged();
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            parameters.ExStyle |= checked((int)(
                WS_EX_TOPMOST
                | WS_EX_TRANSPARENT
                | WS_EX_TOOLWINDOW
                | WS_EX_LAYERED
                | WS_EX_NOACTIVATE
            ));
            return parameters;
        }
    }

    protected override void OnHandleCreated(EventArgs eventArgs)
    {
        base.OnHandleCreated(eventArgs);
        _registeredHandle = Handle;
        OverlayWindowRegistry.Register(_registeredHandle);
        if (!SetWindowDisplayAffinity(Handle, WDA_EXCLUDEFROMCAPTURE))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not exclude the Computer Use safety overlay from capture."
            );
        }
        _captureExcluded = true;
    }

    protected override void OnHandleDestroyed(EventArgs eventArgs)
    {
        OverlayWindowRegistry.Unregister(_registeredHandle);
        _registeredHandle = IntPtr.Zero;
        _captureExcluded = false;
        base.OnHandleDestroyed(eventArgs);
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WmNcHitTest)
        {
            message.Result = new IntPtr(HtTransparent);
            return;
        }
        if (message.Msg == WmMouseActivate)
        {
            message.Result = new IntPtr(MaNoActivate);
            return;
        }
        if (message.Msg == WmDisplayChange)
        {
            _displayChanged();
        }
        base.WndProc(ref message);
    }

    protected override void OnPaintBackground(PaintEventArgs eventArgs)
    {
        using var background = new SolidBrush(TransparencyColor);
        eventArgs.Graphics.FillRectangle(background, eventArgs.ClipRectangle);
    }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        base.OnPaint(eventArgs);
        if (ClientSize.Width <= 4 || ClientSize.Height <= 4)
        {
            return;
        }

        var elapsed = _visualClock.IsRunning ? _visualClock.Elapsed.TotalMilliseconds : 0d;
        DrawEdgeEffect(eventArgs.Graphics, elapsed);

        var (statusText, cancelText) = OverlayText();
        using var font = CreateOverlayFont();
        const TextFormatFlags measureFlags = TextFormatFlags.NoPadding
            | TextFormatFlags.SingleLine;
        var statusSize = TextRenderer.MeasureText(statusText, font, Size.Empty, measureFlags);
        var cancelSize = TextRenderer.MeasureText(cancelText, font, Size.Empty, measureFlags);
        var layout = CalculatePillLayout(ClientSize, DeviceDpi, statusSize, cancelSize);
        _lastPillBounds = layout.Bounds;
        DrawPill(eventArgs.Graphics, font, statusText, cancelText, layout, elapsed);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _animationTimer.Stop();
            _animationTimer.Dispose();
            _visualClock.Stop();
        }
        base.Dispose(disposing);
    }

    internal static OverlayPillLayout CalculatePillLayout(
        Size clientSize,
        int deviceDpi,
        Size statusText,
        Size cancelText
    )
    {
        var scale = Math.Max(0.5d, deviceDpi / 96d);
        var screenMargin = ScaleDip(12, scale);
        var bodyHeight = Math.Min(
            ScaleDip(44, scale),
            Math.Max(1, clientSize.Height - 4)
        );
        var preferredTop = ScaleDip(56, scale);
        var top = Math.Clamp(
            preferredTop,
            2,
            Math.Max(2, clientSize.Height - bodyHeight - 2)
        );
        var horizontalPadding = ScaleDip(12, scale);
        var segmentGap = ScaleDip(12, scale);
        var separatorWidth = Math.Max(1, ScaleDip(1, scale));
        var maxWidth = Math.Max(1, clientSize.Width - screenMargin * 2);
        var contentBudget = Math.Max(
            0,
            maxWidth - horizontalPadding * 2 - segmentGap * 2 - separatorWidth
        );
        var cancelWidth = Math.Min(cancelText.Width, contentBudget);
        var statusWidth = Math.Min(statusText.Width, Math.Max(0, contentBudget - cancelWidth));

        if (statusWidth < statusText.Width && contentBudget > 0)
        {
            var preferredCancelWidth = Math.Min(cancelText.Width, ScaleDip(92, scale));
            cancelWidth = Math.Min(preferredCancelWidth, Math.Max(0, contentBudget / 2));
            statusWidth = Math.Max(0, contentBudget - cancelWidth);
        }

        var pillWidth = Math.Min(
            maxWidth,
            horizontalPadding * 2
                + statusWidth
                + segmentGap * 2
                + separatorWidth
                + cancelWidth
        );
        var pillLeft = Math.Max(0, (clientSize.Width - pillWidth) / 2);
        var bounds = new Rectangle(pillLeft, top, pillWidth, bodyHeight);
        var statusBounds = new Rectangle(
            bounds.Left + horizontalPadding,
            bounds.Top,
            statusWidth,
            bounds.Height
        );
        var separatorHeight = Math.Min(bounds.Height, ScaleDip(16, scale));
        var separatorBounds = new Rectangle(
            statusBounds.Right + segmentGap,
            bounds.Top + (bounds.Height - separatorHeight) / 2,
            separatorWidth,
            separatorHeight
        );
        var cancelBounds = new Rectangle(
            separatorBounds.Right + segmentGap,
            bounds.Top,
            cancelWidth,
            bounds.Height
        );
        return new OverlayPillLayout(
            bounds,
            statusBounds,
            separatorBounds,
            cancelBounds,
            Math.Max(1, bounds.Height / 2)
        );
    }

    private void DrawEdgeEffect(Graphics graphics, double elapsedMilliseconds)
    {
        var scale = Math.Max(0.5d, DeviceDpi / 96d);
        var depth = _palette.Theme == "high-contrast"
            ? Math.Max(2, ScaleDip(2, scale))
            : Math.Max(3, ScaleDip(6, scale));
        var pulse = _animationTimer.Enabled
            ? (Math.Sin(elapsedMilliseconds / BorderPulseMilliseconds * Math.PI * 2d) + 1d) / 2d
            : 0.55d;

        for (var inset = 0; inset < depth; inset++)
        {
            var width = ClientSize.Width - inset * 2 - 1;
            var height = ClientSize.Height - inset * 2 - 1;
            if (width <= 0 || height <= 0)
            {
                break;
            }

            var falloff = depth == 1 ? 1d : 1d - inset / (double)(depth - 1);
            var strength = Math.Clamp(0.24d + falloff * (0.50d + pulse * 0.26d), 0d, 1d);
            var color = _palette.Theme == "high-contrast"
                ? _palette.Border
                : OverlayPalette.Mix(_palette.BorderMuted, _palette.Border, strength);
            if (inset == 0 && _palette.Theme != "high-contrast")
            {
                color = OverlayPalette.Mix(color, _palette.BorderHighlight, 0.34d + pulse * 0.22d);
            }
            using var pen = new Pen(color, 1f);
            graphics.DrawRectangle(pen, inset, inset, width, height);
        }
    }

    private void DrawPill(
        Graphics graphics,
        Font font,
        string statusText,
        string cancelText,
        OverlayPillLayout layout,
        double elapsedMilliseconds
    )
    {
        var previousSmoothingMode = graphics.SmoothingMode;
        graphics.SmoothingMode = SmoothingMode.None;
        using (var outlinePath = RoundedRectangle(layout.Bounds, layout.CornerRadius))
        using (var outline = new SolidBrush(_palette.BannerOutline))
        {
            graphics.FillPath(outline, outlinePath);
        }

        var inset = Math.Max(1, ScaleDip(1, Math.Max(0.5d, DeviceDpi / 96d)));
        var bodyBounds = Rectangle.Inflate(layout.Bounds, -inset, -inset);
        if (bodyBounds.Width > 0 && bodyBounds.Height > 0)
        {
            using var bodyPath = RoundedRectangle(
                bodyBounds,
                Math.Max(1, layout.CornerRadius - inset)
            );
            using var body = new SolidBrush(_palette.Banner);
            graphics.FillPath(body, bodyPath);
        }
        graphics.SmoothingMode = previousSmoothingMode;

        using (var separator = new SolidBrush(_palette.Separator))
        {
            graphics.FillRectangle(separator, layout.SeparatorBounds);
        }

        const TextFormatFlags textFlags = TextFormatFlags.EndEllipsis
            | TextFormatFlags.HorizontalCenter
            | TextFormatFlags.NoPadding
            | TextFormatFlags.SingleLine
            | TextFormatFlags.VerticalCenter;
        var statusColor = OverlayPalette.Mix(_palette.Banner, _palette.Text, 0.88d);
        TextRenderer.DrawText(
            graphics,
            statusText,
            font,
            layout.StatusBounds,
            statusColor,
            textFlags
        );

        if (_animationTimer.Enabled && layout.StatusBounds.Width > 0)
        {
            var scale = Math.Max(0.5d, DeviceDpi / 96d);
            var shimmerWidth = Math.Max(1, ScaleDip(32, scale));
            var progress = (elapsedMilliseconds % TextShimmerMilliseconds) / TextShimmerMilliseconds;
            var travel = layout.StatusBounds.Width + shimmerWidth * 2;
            var shimmerLeft = layout.StatusBounds.Left - shimmerWidth
                + (int)Math.Round(travel * progress);
            var state = graphics.Save();
            graphics.SetClip(
                Rectangle.Intersect(
                    layout.StatusBounds,
                    new Rectangle(
                        shimmerLeft,
                        layout.StatusBounds.Top,
                        shimmerWidth,
                        layout.StatusBounds.Height
                    )
                )
            );
            TextRenderer.DrawText(
                graphics,
                statusText,
                font,
                layout.StatusBounds,
                _palette.Text,
                textFlags
            );
            graphics.Restore(state);
        }

        TextRenderer.DrawText(
            graphics,
            cancelText,
            font,
            layout.CancelBounds,
            _palette.SecondaryText,
            textFlags
        );
    }

    public void PrepareHidden()
    {
        _ = Handle;
        ApplyTopmost(show: false);
        ValidateNativeState(expectedVisible: false);
    }

    public void ShowOverlay()
    {
        var wasVisible = Visible;
        _palette = OverlayPalette.Current();
        Invalidate();
        Show();
        ApplyTopmost(show: true);
        ValidateNativeState(expectedVisible: true);
        if (!wasVisible)
        {
            _visualClock.Restart();
        }
        UpdateAnimationState();
    }

    public void HideOverlay()
    {
        StopVisualAnimation();
        Hide();
        ShowWindow(Handle, SW_HIDE);
    }

    public void RefreshPalette()
    {
        _palette = OverlayPalette.Current();
        UpdateAnimationState();
        Invalidate();
    }

    public OverlayWindowStatus Status()
    {
        var style = GetWindowLongPtr(Handle, GWL_EXSTYLE).ToInt64();
        var affinityOk = GetWindowDisplayAffinity(Handle, out var affinity);
        GetWindowRect(Handle, out var bounds);
        return new OverlayWindowStatus(
            Handle.ToInt64().ToString(CultureInfo.InvariantCulture),
            Rect.FromNative(bounds),
            IsWindowVisible(Handle),
            (style & WS_EX_TOPMOST) != 0,
            (style & WS_EX_NOACTIVATE) != 0,
            (style & WS_EX_TRANSPARENT) != 0,
            (style & WS_EX_TOOLWINDOW) != 0,
            _captureExcluded && affinityOk && affinity == WDA_EXCLUDEFROMCAPTURE,
            _palette.Theme
        );
    }

    private void ApplyTopmost(bool show)
    {
        var flags = SWP_NOACTIVATE | SWP_NOOWNERZORDER;
        if (show)
        {
            flags |= SWP_SHOWWINDOW;
        }
        if (!SetWindowPos(
            Handle,
            HWND_TOPMOST,
            Bounds.X,
            Bounds.Y,
            Bounds.Width,
            Bounds.Height,
            flags
        ))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not position the Computer Use safety overlay."
            );
        }
        if (show)
        {
            ShowWindow(Handle, SW_SHOWNOACTIVATE);
        }
    }

    private void UpdateAnimationState()
    {
        if (
            Visible
            && SystemInformation.UIEffectsEnabled
            && _palette.Theme != "high-contrast"
        )
        {
            if (!_visualClock.IsRunning)
            {
                _visualClock.Start();
            }
            _animationTimer.Start();
            return;
        }
        _animationTimer.Stop();
    }

    private void StopVisualAnimation()
    {
        _animationTimer.Stop();
        _visualClock.Stop();
        _visualClock.Reset();
    }

    private void InvalidateAnimatedRegions()
    {
        if (IsDisposed || !IsHandleCreated || !Visible)
        {
            return;
        }

        var band = Math.Max(2, ScaleDip(8, Math.Max(0.5d, DeviceDpi / 96d)));
        Invalidate(new Rectangle(0, 0, ClientSize.Width, Math.Min(band, ClientSize.Height)));
        Invalidate(
            new Rectangle(
                0,
                Math.Max(0, ClientSize.Height - band),
                ClientSize.Width,
                Math.Min(band, ClientSize.Height)
            )
        );
        Invalidate(new Rectangle(0, 0, Math.Min(band, ClientSize.Width), ClientSize.Height));
        Invalidate(
            new Rectangle(
                Math.Max(0, ClientSize.Width - band),
                0,
                Math.Min(band, ClientSize.Width),
                ClientSize.Height
            )
        );
        if (!_lastPillBounds.IsEmpty)
        {
            Invalidate(Rectangle.Inflate(_lastPillBounds, 2, 2));
        }
    }

    private Font CreateOverlayFont()
    {
        var size = Math.Max(10f, 12f * DeviceDpi / 96f);
        try
        {
            return new Font(
                "Segoe UI Variable",
                size,
                FontStyle.Regular,
                GraphicsUnit.Pixel
            );
        }
        catch (ArgumentException)
        {
            return new Font(
                SystemFonts.MessageBoxFont?.FontFamily ?? FontFamily.GenericSansSerif,
                size,
                FontStyle.Regular,
                GraphicsUnit.Pixel
            );
        }
    }

    private static (string Status, string Cancel) OverlayText()
    {
        return IsChineseUi()
            ? ("Anybox 正在使用你的电脑", "按 Esc 停止")
            : ("Anybox is using your computer", "Press Esc to stop");
    }

    private static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        var diameter = Math.Max(2, Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height)));
        var arc = new Rectangle(bounds.Left, bounds.Top, diameter, diameter);
        path.AddArc(arc, 180f, 90f);
        arc.X = bounds.Right - diameter;
        path.AddArc(arc, 270f, 90f);
        arc.Y = bounds.Bottom - diameter;
        path.AddArc(arc, 0f, 90f);
        arc.X = bounds.Left;
        path.AddArc(arc, 90f, 90f);
        path.CloseFigure();
        return path;
    }

    private static int ScaleDip(int value, double scale)
    {
        return Math.Max(1, (int)Math.Round(value * scale));
    }

    private void ValidateNativeState(bool expectedVisible)
    {
        var status = Status();
        if (
            status.Visible != expectedVisible
            || !status.Topmost
            || !status.NoActivate
            || !status.MouseTransparent
            || !status.ToolWindow
            || !status.CaptureExcluded
            || status.Bounds != new Rect(Bounds.X, Bounds.Y, Bounds.Width, Bounds.Height)
        )
        {
            throw new InvalidOperationException(
                "Computer Use safety overlay window validation failed."
            );
        }
    }

    private static bool IsChineseUi()
    {
        return CultureInfo.InstalledUICulture.Name.StartsWith(
            "zh",
            StringComparison.OrdinalIgnoreCase
        );
    }
}
