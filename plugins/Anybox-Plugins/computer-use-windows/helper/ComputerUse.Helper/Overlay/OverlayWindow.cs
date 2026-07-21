using System.ComponentModel;
using System.Drawing;
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

internal sealed class OverlayWindow : Form
{
    private const int WmNcHitTest = 0x0084;
    private const int WmMouseActivate = 0x0021;
    private const int WmDisplayChange = 0x007E;
    private const int HtTransparent = -1;
    private const int MaNoActivate = 3;
    private static readonly Color TransparencyColor = Color.FromArgb(0xFF, 0x00, 0xFF);

    private readonly Action _displayChanged;
    private OverlayPalette _palette;
    private bool _captureExcluded;
    private IntPtr _registeredHandle;

    public OverlayWindow(Screen screen, Action displayChanged)
    {
        _displayChanged = displayChanged;
        _palette = OverlayPalette.Current();
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
        eventArgs.Graphics.Clear(TransparencyColor);
    }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        base.OnPaint(eventArgs);
        if (ClientSize.Width <= 4 || ClientSize.Height <= 4)
        {
            return;
        }

        using var border = new Pen(_palette.Border, 2f);
        eventArgs.Graphics.DrawRectangle(
            border,
            1,
            1,
            ClientSize.Width - 2,
            ClientSize.Height - 2
        );

        var message = IsChineseUi()
            ? "Anybox 正在使用你的电脑 · 按 Esc 停止"
            : "Anybox is using your computer · Press Esc to stop";
        using var font = new Font(
            SystemFonts.MessageBoxFont?.FontFamily ?? FontFamily.GenericSansSerif,
            Math.Max(10f, 11f * DeviceDpi / 96f),
            FontStyle.Regular,
            GraphicsUnit.Pixel
        );
        var measured = TextRenderer.MeasureText(
            message,
            font,
            Size.Empty,
            TextFormatFlags.NoPadding | TextFormatFlags.SingleLine
        );
        var horizontalPadding = Math.Max(14, (int)Math.Round(14 * DeviceDpi / 96d));
        var verticalPadding = Math.Max(8, (int)Math.Round(8 * DeviceDpi / 96d));
        var bannerWidth = Math.Min(
            ClientSize.Width - 4,
            measured.Width + horizontalPadding * 2
        );
        var bannerHeight = measured.Height + verticalPadding * 2;
        var banner = new Rectangle(
            Math.Max(2, (ClientSize.Width - bannerWidth) / 2),
            0,
            bannerWidth,
            bannerHeight
        );
        using var background = new SolidBrush(_palette.Banner);
        eventArgs.Graphics.FillRectangle(background, banner);
        TextRenderer.DrawText(
            eventArgs.Graphics,
            message,
            font,
            banner,
            _palette.Text,
            TextFormatFlags.HorizontalCenter
                | TextFormatFlags.VerticalCenter
                | TextFormatFlags.NoPadding
                | TextFormatFlags.SingleLine
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
        _palette = OverlayPalette.Current();
        Invalidate();
        Show();
        ApplyTopmost(show: true);
        ValidateNativeState(expectedVisible: true);
    }

    public void HideOverlay()
    {
        Hide();
        ShowWindow(Handle, SW_HIDE);
    }

    public void RefreshPalette()
    {
        _palette = OverlayPalette.Current();
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
