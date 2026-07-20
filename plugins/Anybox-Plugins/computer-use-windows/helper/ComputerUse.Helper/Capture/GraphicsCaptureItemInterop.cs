using System.Runtime.InteropServices;
using Windows.Graphics.Capture;

namespace ComputerUse.Helper.Capture;

[ComImport]
[Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IGraphicsCaptureItemInterop
{
    IntPtr CreateForWindow(IntPtr window, in Guid iid);

    IntPtr CreateForMonitor(IntPtr monitor, in Guid iid);
}

internal static class GraphicsCaptureItemInterop
{
    private static readonly Guid GraphicsCaptureItemGuid =
        new("79C3F95B-31F7-4EC2-A464-632EF5D30760");

    public static GraphicsCaptureItem CreateForWindow(IntPtr hwnd)
    {
        var interop = GraphicsCaptureItem.As<IGraphicsCaptureItemInterop>();
        var pointer = interop.CreateForWindow(hwnd, GraphicsCaptureItemGuid);
        if (pointer == IntPtr.Zero)
        {
            throw new InvalidOperationException("CreateForWindow returned a null capture item.");
        }
        try
        {
            return GraphicsCaptureItem.FromAbi(pointer);
        }
        finally
        {
            Marshal.Release(pointer);
        }
    }
}
