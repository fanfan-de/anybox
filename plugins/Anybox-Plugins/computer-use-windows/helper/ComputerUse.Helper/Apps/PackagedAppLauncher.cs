using System.Runtime.InteropServices;

namespace ComputerUse.Helper.Apps;

[Flags]
internal enum ActivateOptions : uint
{
    None = 0,
}

[ComImport]
[Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IApplicationActivationManager
{
    [PreserveSig]
    int ActivateApplication(
        [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments,
        ActivateOptions options,
        out uint processId
    );

    [PreserveSig]
    int ActivateForFile(
        [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        IntPtr shellItemArray,
        [MarshalAs(UnmanagedType.LPWStr)] string verb,
        out uint processId
    );

    [PreserveSig]
    int ActivateForProtocol(
        [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        IntPtr shellItemArray,
        out uint processId
    );
}

[ComImport]
[Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c")]
internal class ApplicationActivationManager;

internal static class PackagedAppLauncher
{
    public static int Launch(string aumid)
    {
        var manager = (IApplicationActivationManager)new ApplicationActivationManager();
        try
        {
            var result = manager.ActivateApplication(
                aumid,
                "",
                ActivateOptions.None,
                out var processId
            );
            Marshal.ThrowExceptionForHR(result);
            return checked((int)processId);
        }
        finally
        {
            if (Marshal.IsComObject(manager))
            {
                Marshal.ReleaseComObject(manager);
            }
        }
    }
}
