using System.Drawing;
using System.Drawing.Imaging;
using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.Windows;

namespace ComputerUse.Helper.Capture;

internal sealed record CapturedFrame(
    byte[] Png,
    int Width,
    int Height,
    int OriginX,
    int OriginY
);

internal static class ScreenCapture
{
    private const long MaxPixels = 16_000_000;

    public static CapturedFrame Capture(WindowInfo observed)
    {
        var window = WindowGuard.ActivateAndVerify(observed);
        Thread.Sleep(100);
        window = WindowInfo.FromHandle(window.Handle) ?? throw new ComputerUseException(
            "CU_WINDOW_NOT_FOUND",
            "The selected window closed before capture.",
            retryable: true
        );
        var bounds = window.Bounds;
        if (
            bounds.Width <= 0
            || bounds.Height <= 0
            || (long)bounds.Width * bounds.Height > MaxPixels
        )
        {
            throw new ComputerUseException(
                "CU_INVALID_ARGUMENT",
                "Window capture dimensions are outside the supported range."
            );
        }

        using var bitmap = new Bitmap(bounds.Width, bounds.Height);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.CopyFromScreen(
                bounds.X,
                bounds.Y,
                0,
                0,
                new Size(bounds.Width, bounds.Height),
                CopyPixelOperation.SourceCopy
            );
        }
        using var stream = new MemoryStream();
        bitmap.Save(stream, ImageFormat.Png);
        return new CapturedFrame(stream.ToArray(), bounds.Width, bounds.Height, 0, 0);
    }
}
