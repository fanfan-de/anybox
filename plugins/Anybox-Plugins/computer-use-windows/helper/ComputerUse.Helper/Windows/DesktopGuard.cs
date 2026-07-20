using ComputerUse.Helper.Protocol;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper.Windows;

internal static class DesktopGuard
{
    public static void AssertInteractive()
    {
        var desktop = OpenInputDesktop(
            0,
            inherit: false,
            DESKTOP_READOBJECTS | DESKTOP_SWITCHDESKTOP
        );
        if (desktop == IntPtr.Zero)
        {
            throw Locked();
        }
        try
        {
            if (!SwitchDesktop(desktop))
            {
                throw Locked();
            }
        }
        finally
        {
            CloseDesktop(desktop);
        }
    }

    private static ComputerUseException Locked()
    {
        return new ComputerUseException(
            "CU_DESKTOP_LOCKED",
            "The interactive desktop is locked or unavailable.",
            retryable: true,
            requiresFreshState: true
        );
    }
}
