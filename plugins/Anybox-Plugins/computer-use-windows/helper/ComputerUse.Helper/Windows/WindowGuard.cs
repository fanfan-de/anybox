using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.Overlay;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper.Windows;

internal static class WindowGuard
{
    public static WindowInfo ActivateAndVerify(WindowInfo window)
    {
        if (window.Minimized)
        {
            ShowWindowAsync(window.Handle, SW_RESTORE);
        }
        TryActivate(window.Handle);

        var deadline = Environment.TickCount64 + 750;
        while (Environment.TickCount64 < deadline)
        {
            var foreground = GetForegroundWindow();
            var foregroundRoot = foreground == IntPtr.Zero
                ? IntPtr.Zero
                : GetAncestor(foreground, GA_ROOTOWNER);
            if (foregroundRoot == IntPtr.Zero)
            {
                foregroundRoot = foreground;
            }
            if (foregroundRoot.ToInt64().ToString() == window.Identity.RootOwnerHwnd)
            {
                return WindowInfo.FromHandle(window.Handle) ?? window;
            }
            Thread.Sleep(25);
        }

        throw new ComputerUseException(
            "CU_WINDOW_NOT_FOREGROUND",
            "Windows did not confirm the target window in the foreground.",
            retryable: true,
            requiresFreshState: true
        );
    }

    private static void TryActivate(IntPtr target)
    {
        var currentThread = GetCurrentThreadId();
        var targetThread = GetWindowThreadProcessId(target, out _);
        var foreground = GetForegroundWindow();
        var foregroundThread = foreground == IntPtr.Zero
            ? 0
            : GetWindowThreadProcessId(foreground, out _);
        var attached = new List<(uint Source, uint Target)>(2);
        try
        {
            Attach(currentThread, targetThread, attached);
            Attach(foregroundThread, targetThread, attached);
            ShowWindowAsync(target, SW_RESTORE);
            BringWindowToTop(target);
            SetForegroundWindow(target);
            SetFocus(target);
        }
        finally
        {
            for (var index = attached.Count - 1; index >= 0; index--)
            {
                var pair = attached[index];
                AttachThreadInput(pair.Source, pair.Target, false);
            }
        }
    }

    private static void Attach(
        uint source,
        uint target,
        List<(uint Source, uint Target)> attached
    )
    {
        if (source == 0 || target == 0 || source == target)
        {
            return;
        }
        if (AttachThreadInput(source, target, true))
        {
            attached.Add((source, target));
        }
    }

    public static void AssertObservedState(
        WindowInfo current,
        Rect observedBounds,
        double observedDpiScale,
        long observedInputEpoch
    )
    {
        if (current.Bounds != observedBounds || Math.Abs(current.DpiScale - observedDpiScale) > 0.001)
        {
            throw new ComputerUseException(
                "CU_WINDOW_CHANGED",
                "Window bounds or DPI changed after observation.",
                retryable: true,
                requiresFreshState: true
            );
        }
        if (observedInputEpoch != PhysicalInputState.Epoch)
        {
            throw new ComputerUseException(
                "CU_USER_INPUT_DETECTED",
                "User input occurred after observation.",
                retryable: true,
                requiresFreshState: true
            );
        }
    }

    public static void AssertPointOwnedBy(WindowInfo target, int screenX, int screenY)
    {
        var pointWindow = OverlayWindowRegistry.WindowFromPointIgnoringOverlays(
            new POINT { X = screenX, Y = screenY }
        );
        var pointRoot = pointWindow == IntPtr.Zero ? IntPtr.Zero : GetAncestor(pointWindow, GA_ROOTOWNER);
        if (pointRoot == IntPtr.Zero)
        {
            pointRoot = pointWindow;
        }
        if (pointRoot.ToInt64().ToString() != target.Identity.RootOwnerHwnd)
        {
            throw new ComputerUseException(
                "CU_POINT_OUTSIDE_TARGET",
                "The requested point is currently covered by another window.",
                retryable: true,
                requiresFreshState: true
            );
        }
    }
}
