using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using ComputerUse.Helper.Apps;
using ComputerUse.Helper.Policy;
using ComputerUse.Helper.Protocol;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper.Windows;

internal readonly record struct Rect(int X, int Y, int Width, int Height)
{
    public static Rect FromNative(RECT value)
    {
        return new Rect(value.Left, value.Top, value.Right - value.Left, value.Bottom - value.Top);
    }

    public static Rect FromJson(JsonElement value)
    {
        return new Rect(
            JsonArgs.Int32(value, "x"),
            JsonArgs.Int32(value, "y"),
            JsonArgs.Int32(value, "width"),
            JsonArgs.Int32(value, "height")
        );
    }
}

internal sealed record WindowIdentity(
    string Hwnd,
    int Pid,
    string ProcessStartTime,
    string RootOwnerHwnd,
    string ExecutableIdentity,
    int SessionId,
    string IntegrityLevel
);

internal sealed record WindowInfo(
    IntPtr Handle,
    WindowIdentity Identity,
    string Title,
    string ProcessName,
    string AppId,
    Rect Bounds,
    Rect ClientBounds,
    double DpiScale,
    bool Minimized
)
{
    public object ToProtocolObject()
    {
        return new
        {
            identity = Identity,
            title = Title,
            processName = ProcessName,
            appId = AppId,
            bounds = Bounds,
            clientBounds = ClientBounds,
            dpiScale = DpiScale,
            minimized = Minimized,
        };
    }

    public static WindowInfo FromExpected(JsonElement expectedIdentity)
    {
        var hwnd = ParseHandle(JsonArgs.String(expectedIdentity, "hwnd", required: true));
        var current = FromHandle(hwnd) ?? throw new ComputerUseException(
            "CU_WINDOW_NOT_FOUND",
            "The selected window is no longer available.",
            retryable: true
        );
        var expected = new WindowIdentity(
            JsonArgs.String(expectedIdentity, "hwnd", required: true),
            JsonArgs.Int32(expectedIdentity, "pid"),
            JsonArgs.String(expectedIdentity, "processStartTime", required: true),
            JsonArgs.String(expectedIdentity, "rootOwnerHwnd", required: true),
            JsonArgs.String(expectedIdentity, "executableIdentity", required: true),
            JsonArgs.Int32(expectedIdentity, "sessionId", 0),
            JsonArgs.String(expectedIdentity, "integrityLevel", required: true)
        );
        if (!IdentityMatches(current.Identity, expected))
        {
            throw new ComputerUseException(
                "CU_WINDOW_CHANGED",
                "The selected window identity changed.",
                retryable: true,
                requiresFreshState: true
            );
        }
        return current;
    }

    public static WindowInfo? FromHandle(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd))
        {
            return null;
        }
        GetWindowThreadProcessId(hwnd, out var rawPid);
        if (rawPid == 0 || !TryGetWindowBounds(hwnd, out var bounds))
        {
            return null;
        }

        try
        {
            using var process = Process.GetProcessById(checked((int)rawPid));
            var processName = process.ProcessName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                ? process.ProcessName.ToLowerInvariant()
                : $"{process.ProcessName.ToLowerInvariant()}.exe";
            string executableIdentity;
            try
            {
                executableIdentity = (process.MainModule?.FileName ?? processName)
                    .Trim()
                    .ToLowerInvariant();
            }
            catch
            {
                executableIdentity = processName;
            }

            var rootOwner = GetAncestor(hwnd, GA_ROOTOWNER);
            if (rootOwner == IntPtr.Zero)
            {
                rootOwner = hwnd;
            }
            var dpi = 96u;
            try
            {
                dpi = GetDpiForWindow(hwnd);
            }
            catch
            {
                // Windows 11 always supports GetDpiForWindow. Keep 96 as a guarded fallback.
            }

            var identity = new WindowIdentity(
                hwnd.ToInt64().ToString(CultureInfo.InvariantCulture),
                checked((int)rawPid),
                process.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture),
                rootOwner.ToInt64().ToString(CultureInfo.InvariantCulture),
                executableIdentity,
                process.SessionId,
                IntegrityInspector.ForProcess(checked((int)rawPid))
            );
            return new WindowInfo(
                hwnd,
                identity,
                GetWindowTitle(hwnd),
                processName,
                AppIdentity.ForWin32(processName, executableIdentity),
                bounds,
                GetClientBounds(hwnd, bounds),
                Math.Round(dpi / 96.0, 4),
                IsIconic(hwnd)
            );
        }
        catch
        {
            return null;
        }
    }

    public static bool IsCandidate(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsCloaked(hwnd))
        {
            return false;
        }
        if (string.IsNullOrWhiteSpace(GetWindowTitle(hwnd)))
        {
            return false;
        }
        return TryGetWindowBounds(hwnd, out var bounds) && bounds.Width > 0 && bounds.Height > 0;
    }

    public static List<WindowInfo> EnumerateCandidates()
    {
        var windows = new List<WindowInfo>();
        EnumWindows((hwnd, _) =>
        {
            if (IsCandidate(hwnd) && FromHandle(hwnd) is { } info)
            {
                windows.Add(info);
            }
            return true;
        }, IntPtr.Zero);
        return windows;
    }

    private static bool IdentityMatches(WindowIdentity current, WindowIdentity expected)
    {
        return current.Hwnd == expected.Hwnd
            && current.Pid == expected.Pid
            && current.ProcessStartTime == expected.ProcessStartTime
            && current.RootOwnerHwnd == expected.RootOwnerHwnd
            && string.Equals(
                current.ExecutableIdentity,
                expected.ExecutableIdentity,
                StringComparison.OrdinalIgnoreCase
            )
            && current.SessionId == expected.SessionId
            && current.IntegrityLevel == expected.IntegrityLevel;
    }

    private static IntPtr ParseHandle(string value)
    {
        if (!long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var handle))
        {
            throw new ComputerUseException("CU_INVALID_ARGUMENT", "Window identity contains an invalid handle.");
        }
        return new IntPtr(handle);
    }

    private static bool IsCloaked(IntPtr hwnd)
    {
        var cloaked = 0;
        var result = DwmGetWindowAttribute(hwnd, 14, out cloaked, Marshal.SizeOf<int>());
        return result == 0 && cloaked != 0;
    }

    private static string GetWindowTitle(IntPtr hwnd)
    {
        var length = GetWindowTextLength(hwnd);
        if (length <= 0)
        {
            return "";
        }
        var builder = new StringBuilder(length + 1);
        GetWindowText(hwnd, builder, builder.Capacity);
        return builder.ToString();
    }

    private static bool TryGetWindowBounds(IntPtr hwnd, out Rect bounds)
    {
        if (
            DwmGetWindowAttribute(hwnd, 9, out RECT extendedFrame, Marshal.SizeOf<RECT>()) == 0
            && extendedFrame.Right > extendedFrame.Left
            && extendedFrame.Bottom > extendedFrame.Top
        )
        {
            bounds = Rect.FromNative(extendedFrame);
            return true;
        }
        if (GetWindowRect(hwnd, out var rect))
        {
            bounds = Rect.FromNative(rect);
            return true;
        }
        bounds = default;
        return false;
    }

    private static Rect GetClientBounds(IntPtr hwnd, Rect windowBounds)
    {
        if (!GetClientRect(hwnd, out var clientRect))
        {
            return new Rect(0, 0, windowBounds.Width, windowBounds.Height);
        }
        var topLeft = new POINT();
        ClientToScreen(hwnd, ref topLeft);
        return new Rect(
            topLeft.X - windowBounds.X,
            topLeft.Y - windowBounds.Y,
            clientRect.Right - clientRect.Left,
            clientRect.Bottom - clientRect.Top
        );
    }
}
