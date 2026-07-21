using System.Collections.Concurrent;
using ComputerUse.Helper.Windows;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper.Overlay;

internal static class OverlayWindowRegistry
{
    private static readonly ConcurrentDictionary<IntPtr, byte> Handles = new();

    public static void Register(IntPtr hwnd)
    {
        if (hwnd != IntPtr.Zero)
        {
            Handles[hwnd] = 0;
        }
    }

    public static void Unregister(IntPtr hwnd)
    {
        if (hwnd != IntPtr.Zero)
        {
            Handles.TryRemove(hwnd, out _);
        }
    }

    public static bool IsOverlay(IntPtr hwnd)
    {
        return hwnd != IntPtr.Zero && Handles.ContainsKey(hwnd);
    }

    public static IntPtr[] SnapshotHandles()
    {
        return Handles.Keys.ToArray();
    }

    public static void HideAllImmediately()
    {
        foreach (var hwnd in SnapshotHandles())
        {
            if (IsWindow(hwnd))
            {
                ShowWindow(hwnd, SW_HIDE);
            }
        }
    }

    public static IntPtr WindowFromPointIgnoringOverlays(POINT point)
    {
        var hit = WindowFromPoint(point);
        if (!IsOverlay(hit))
        {
            return hit;
        }

        var candidate = hit;
        while ((candidate = GetWindow(candidate, GW_HWNDNEXT)) != IntPtr.Zero)
        {
            if (IsOverlay(candidate) || !IsWindowVisible(candidate))
            {
                continue;
            }
            if (
                GetWindowRect(candidate, out var bounds)
                && point.X >= bounds.Left
                && point.X < bounds.Right
                && point.Y >= bounds.Top
                && point.Y < bounds.Bottom
            )
            {
                return candidate;
            }
        }
        return IntPtr.Zero;
    }
}
