using System.Runtime.InteropServices;
using Windows.Graphics.DirectX.Direct3D11;

namespace ComputerUse.Helper.Capture;

internal sealed class D3DDevice : IDisposable
{
    private const uint D3D11CreateDeviceBgraSupport = 0x20;
    private const uint D3D11SdkVersion = 7;
    private const int D3DDriverTypeHardware = 1;
    private const int D3DDriverTypeWarp = 5;
    private static readonly Guid IdxgiDeviceGuid =
        new("54EC77FA-1377-44E6-8C32-88FD5F44C84C");

    private D3DDevice(IDirect3DDevice device)
    {
        Device = device;
    }

    public IDirect3DDevice Device { get; }

    public static D3DDevice Create()
    {
        var result = TryCreateNativeDevice(D3DDriverTypeHardware, out var device, out var context);
        if (result < 0)
        {
            result = TryCreateNativeDevice(D3DDriverTypeWarp, out device, out context);
        }
        Marshal.ThrowExceptionForHR(result);

        IntPtr dxgiDevice = IntPtr.Zero;
        IntPtr inspectable = IntPtr.Zero;
        try
        {
            var iid = IdxgiDeviceGuid;
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device, in iid, out dxgiDevice));
            Marshal.ThrowExceptionForHR(
                CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice, out inspectable)
            );
            var projected = WinRT.MarshalInterface<IDirect3DDevice>.FromAbi(inspectable);
            return new D3DDevice(projected);
        }
        finally
        {
            if (inspectable != IntPtr.Zero)
            {
                Marshal.Release(inspectable);
            }
            if (dxgiDevice != IntPtr.Zero)
            {
                Marshal.Release(dxgiDevice);
            }
            if (context != IntPtr.Zero)
            {
                Marshal.Release(context);
            }
            if (device != IntPtr.Zero)
            {
                Marshal.Release(device);
            }
        }
    }

    public void Dispose()
    {
        Device.Dispose();
    }

    private static int TryCreateNativeDevice(
        int driverType,
        out IntPtr device,
        out IntPtr context
    )
    {
        return D3D11CreateDevice(
            IntPtr.Zero,
            driverType,
            IntPtr.Zero,
            D3D11CreateDeviceBgraSupport,
            IntPtr.Zero,
            0,
            D3D11SdkVersion,
            out device,
            out _,
            out context
        );
    }

    [DllImport("d3d11.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int D3D11CreateDevice(
        IntPtr adapter,
        int driverType,
        IntPtr software,
        uint flags,
        IntPtr featureLevels,
        uint featureLevelsCount,
        uint sdkVersion,
        out IntPtr device,
        out int selectedFeatureLevel,
        out IntPtr immediateContext
    );

    [DllImport("d3d11.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int CreateDirect3D11DeviceFromDXGIDevice(
        IntPtr dxgiDevice,
        out IntPtr graphicsDevice
    );
}
