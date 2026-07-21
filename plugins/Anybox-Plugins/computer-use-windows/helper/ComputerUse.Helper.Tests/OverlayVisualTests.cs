using ComputerUse.Helper.Overlay;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ComputerUse.Helper.Tests;

[TestClass]
public sealed class OverlayVisualTests
{
    [TestMethod]
    public void StatusPillUsesCodexLikeDesktopMetrics()
    {
        var layout = OverlayWindow.CalculatePillLayout(
            new Size(1920, 1080),
            deviceDpi: 96,
            statusText: new Size(180, 16),
            cancelText: new Size(80, 16)
        );

        Assert.AreEqual(56, layout.Bounds.Top);
        Assert.AreEqual(44, layout.Bounds.Height);
        Assert.AreEqual(22, layout.CornerRadius);
        Assert.AreEqual(16, layout.SeparatorBounds.Height);
        Assert.AreEqual(
            1920 / 2,
            layout.Bounds.Left + layout.Bounds.Width / 2,
            1
        );
        Assert.IsTrue(layout.Bounds.Contains(layout.StatusBounds));
        Assert.IsTrue(layout.Bounds.Contains(layout.SeparatorBounds));
        Assert.IsTrue(layout.Bounds.Contains(layout.CancelBounds));
    }

    [TestMethod]
    public void StatusPillScalesWithDisplayDpi()
    {
        var layout = OverlayWindow.CalculatePillLayout(
            new Size(3840, 2160),
            deviceDpi: 192,
            statusText: new Size(360, 32),
            cancelText: new Size(160, 32)
        );

        Assert.AreEqual(112, layout.Bounds.Top);
        Assert.AreEqual(88, layout.Bounds.Height);
        Assert.AreEqual(44, layout.CornerRadius);
        Assert.AreEqual(32, layout.SeparatorBounds.Height);
        Assert.AreEqual(
            3840 / 2,
            layout.Bounds.Left + layout.Bounds.Width / 2,
            1
        );
    }

    [TestMethod]
    public void StatusPillKeepsBothSegmentsInsideANarrowDisplay()
    {
        var layout = OverlayWindow.CalculatePillLayout(
            new Size(220, 160),
            deviceDpi: 96,
            statusText: new Size(400, 16),
            cancelText: new Size(180, 16)
        );

        Assert.IsTrue(layout.Bounds.Left >= 12);
        Assert.IsTrue(layout.Bounds.Right <= 220 - 12);
        Assert.IsTrue(layout.StatusBounds.Width >= 0);
        Assert.IsTrue(layout.CancelBounds.Width >= 0);
        Assert.IsTrue(layout.StatusBounds.Right <= layout.SeparatorBounds.Left);
        Assert.IsTrue(layout.SeparatorBounds.Right <= layout.CancelBounds.Left);
        Assert.IsTrue(layout.CancelBounds.Right <= layout.Bounds.Right);
    }

    [TestMethod]
    public void PaletteMixProducesOpaqueStableColors()
    {
        var mixed = OverlayPalette.Mix(Color.Black, Color.White, 0.5d);

        Assert.AreEqual(255, mixed.A);
        Assert.AreEqual(128, mixed.R);
        Assert.AreEqual(128, mixed.G);
        Assert.AreEqual(128, mixed.B);
    }
}
