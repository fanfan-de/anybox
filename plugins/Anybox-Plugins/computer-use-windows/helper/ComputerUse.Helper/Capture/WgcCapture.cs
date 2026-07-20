using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.Windows;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace ComputerUse.Helper.Capture;

internal static class WgcCapture
{
    private const long MaxPixels = 16_000_000;
    // The PNG is base64-encoded inside a framed JSON-RPC response. Reserve room
    // for the JSON envelope and apply base64's 4/3 expansion before accepting it.
    private const long MaxPngBytes = (BuildInfo.MaxFrameBytes - 512 * 1024L) * 3 / 4;
    private static readonly TimeSpan CaptureTimeout = TimeSpan.FromSeconds(10);

    public static bool IsSupported()
    {
        try
        {
            return GraphicsCaptureSession.IsSupported();
        }
        catch
        {
            return false;
        }
    }

    public static CapturedFrame Capture(WindowInfo window)
    {
        try
        {
            return CaptureAsync(window).GetAwaiter().GetResult();
        }
        catch (ComputerUseException)
        {
            throw;
        }
        catch (TimeoutException error)
        {
            throw new ComputerUseException(
                "CU_TIMEOUT",
                "Windows Graphics Capture timed out.",
                retryable: true,
                requiresFreshState: true,
                innerException: error
            );
        }
        catch (Exception error)
        {
            throw new ComputerUseException(
                "CU_INTERNAL_ERROR",
                "Windows Graphics Capture failed.",
                retryable: true,
                requiresFreshState: true,
                innerException: error
            );
        }
    }

    private static async Task<CapturedFrame> CaptureAsync(WindowInfo window)
    {
        if (!IsSupported())
        {
            throw new ComputerUseException(
                "CU_UNSUPPORTED_PLATFORM",
                "Windows Graphics Capture is unavailable on this system."
            );
        }
        if (window.Minimized)
        {
            throw new ComputerUseException(
                "CU_WINDOW_CHANGED",
                "Minimized windows cannot be captured reliably.",
                retryable: true,
                requiresFreshState: true
            );
        }

        var item = GraphicsCaptureItemInterop.CreateForWindow(window.Handle);
        var size = item.Size;
        if (
            size.Width <= 0
            || size.Height <= 0
            || (long)size.Width * size.Height > MaxPixels
        )
        {
            throw new ComputerUseException(
                "CU_INVALID_ARGUMENT",
                "Window capture dimensions are outside the supported range."
            );
        }

        using var device = D3DDevice.Create();
        using var framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(
            device.Device,
            DirectXPixelFormat.B8G8R8A8UIntNormalized,
            2,
            size
        );
        using var session = framePool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled = false;

        var completion = new TaskCompletionSource<Direct3D11CaptureFrame>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        void OnFrameArrived(
            Direct3D11CaptureFramePool sender,
            object arguments
        )
        {
            try
            {
                var frame = sender.TryGetNextFrame();
                if (frame is not null && !completion.TrySetResult(frame))
                {
                    frame.Dispose();
                }
            }
            catch (Exception error)
            {
                completion.TrySetException(error);
            }
        }

        framePool.FrameArrived += OnFrameArrived;
        try
        {
            session.StartCapture();
            using var frame = await completion.Task.WaitAsync(CaptureTimeout);
            var contentSize = frame.ContentSize;
            if (
                contentSize.Width <= 0
                || contentSize.Height <= 0
                || (long)contentSize.Width * contentSize.Height > MaxPixels
            )
            {
                throw new ComputerUseException(
                    "CU_WINDOW_CHANGED",
                    "Window capture size changed to an unsupported value.",
                    retryable: true,
                    requiresFreshState: true
                );
            }

            using var bitmap = await SoftwareBitmap.CreateCopyFromSurfaceAsync(
                frame.Surface,
                BitmapAlphaMode.Premultiplied
            );
            var png = await EncodePngAsync(bitmap);
            return new CapturedFrame(
                png,
                contentSize.Width,
                contentSize.Height,
                0,
                0
            );
        }
        finally
        {
            framePool.FrameArrived -= OnFrameArrived;
        }
    }

    private static async Task<byte[]> EncodePngAsync(SoftwareBitmap bitmap)
    {
        using var stream = new InMemoryRandomAccessStream();
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
        encoder.SetSoftwareBitmap(bitmap);
        await encoder.FlushAsync();
        if (stream.Size <= 0 || stream.Size > MaxPngBytes)
        {
            throw new ComputerUseException(
                "CU_INTERNAL_ERROR",
                "Captured PNG exceeds the helper protocol frame budget."
            );
        }
        stream.Seek(0);
        using var reader = new DataReader(stream.GetInputStreamAt(0));
        await reader.LoadAsync(checked((uint)stream.Size));
        var bytes = GC.AllocateUninitializedArray<byte>(checked((int)stream.Size));
        reader.ReadBytes(bytes);
        return bytes;
    }
}
