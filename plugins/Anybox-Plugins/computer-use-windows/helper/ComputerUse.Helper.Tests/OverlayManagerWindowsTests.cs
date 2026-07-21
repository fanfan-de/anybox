using System.Diagnostics;
using ComputerUse.Helper.Input;
using ComputerUse.Helper.Overlay;
using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.Windows;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper.Tests;

[TestClass]
public sealed class OverlayManagerWindowsTests
{
    [TestMethod]
    public void CreatesOneHiddenCaptureExcludedWindowPerDisplay()
    {
        RequireInteractiveWindows();
        using var manager = new OverlayManager(_ => { });

        manager.Initialize();
        var status = manager.Status();

        Assert.IsTrue(status.Available, status.Diagnostic);
        Assert.IsFalse(status.Visible);
        Assert.AreEqual(Screen.AllScreens.Length, status.WindowCount);
        Assert.AreEqual(status.WindowCount, OverlayWindowRegistry.SnapshotHandles().Length);
        foreach (var window in status.Windows)
        {
            Assert.IsFalse(window.Visible);
            Assert.IsTrue(window.Topmost);
            Assert.IsTrue(window.NoActivate);
            Assert.IsTrue(window.MouseTransparent);
            Assert.IsTrue(window.ToolWindow);
            Assert.IsTrue(window.CaptureExcluded);
            CollectionAssert.Contains(
                new[] { "light", "dark", "high-contrast" },
                window.Theme
            );
        }
    }

    [TestMethod]
    public void ShowsWithoutFocusAndIsIgnoredByEnumerationAndHitTesting()
    {
        RequireInteractiveWindows();
        using var manager = new OverlayManager(_ => { });
        manager.Initialize();
        var foregroundBefore = GetForegroundWindow();

        manager.ShowForDesktopAccess();
        var status = manager.Status();

        Assert.IsTrue(status.Visible);
        Assert.IsTrue(status.Windows.All(window => window.Visible));
        Assert.IsFalse(OverlayWindowRegistry.IsOverlay(GetForegroundWindow()));
        if (foregroundBefore != IntPtr.Zero)
        {
            Assert.AreEqual(foregroundBefore, GetForegroundWindow());
        }
        foreach (var handle in OverlayWindowRegistry.SnapshotHandles())
        {
            Assert.IsFalse(WindowInfo.IsCandidate(handle));
        }
        var primary = Screen.PrimaryScreen ?? Screen.AllScreens[0];
        var point = new POINT
        {
            X = primary.Bounds.Left + primary.Bounds.Width / 2,
            Y = primary.Bounds.Top + primary.Bounds.Height / 2,
        };
        Assert.IsFalse(
            OverlayWindowRegistry.IsOverlay(
                OverlayWindowRegistry.WindowFromPointIgnoringOverlays(point)
            )
        );
    }

    [TestMethod]
    public void NormalEndWaitsButPhysicalInterruptionAndDisposeHideImmediately()
    {
        RequireInteractiveWindows();
        var manager = new OverlayManager(_ => { });
        manager.Initialize();
        manager.ShowForDesktopAccess();

        var stopwatch = Stopwatch.StartNew();
        manager.EndTurn();
        stopwatch.Stop();
        Assert.IsTrue(
            stopwatch.ElapsedMilliseconds >= OverlaySessionState.MinimumVisibleMilliseconds - 75,
            $"Overlay ended after only {stopwatch.ElapsedMilliseconds} ms."
        );
        Assert.IsTrue(manager.Status().Windows.All(window => !window.Visible));

        manager.ShowForDesktopAccess();
        stopwatch.Restart();
        manager.InterruptImmediately();
        stopwatch.Stop();
        Assert.IsTrue(stopwatch.ElapsedMilliseconds < 250);
        Assert.IsTrue(manager.Status().Windows.All(window => !window.Visible));

        manager.Dispose();
        Assert.AreEqual(0, OverlayWindowRegistry.SnapshotHandles().Length);
    }

    [TestMethod]
    public void RuntimeFailureFailsClosedAndNotifiesOnce()
    {
        RequireInteractiveWindows();
        var failures = new List<ComputerUseException>();
        using var manager = new OverlayManager(failures.Add);
        manager.Initialize();
        manager.ShowForDesktopAccess();

        manager.SimulateRuntimeFailureForTests();
        manager.SimulateRuntimeFailureForTests();

        Assert.AreEqual(1, failures.Count);
        Assert.AreEqual("CU_OVERLAY_UNAVAILABLE", failures[0].Code);
        Assert.IsFalse(manager.Status().Available);
        var error = Assert.ThrowsException<ComputerUseException>(
            manager.ShowForDesktopAccess
        );
        Assert.AreEqual("CU_OVERLAY_UNAVAILABLE", error.Code);
        Assert.IsTrue(
            OverlayWindowRegistry.SnapshotHandles().All(handle => !IsWindowVisible(handle))
        );
    }

    [TestMethod]
    public void SyntheticInputMarkerCannotBeMistakenForPhysicalEscape()
    {
        Assert.IsFalse(
            PhysicalInputState.IsPhysicalInput(InputController.SyntheticInputMarker)
        );
        Assert.IsTrue(PhysicalInputState.IsPhysicalInput(IntPtr.Zero));
    }

    [TestMethod]
    public void EscapeClassifierIgnoresSyntheticInputAndImmediatelyHandlesPhysicalInput()
    {
        RequireInteractiveWindows();
        using var manager = new OverlayManager(_ => { });
        using var interrupted = new ManualResetEventSlim(false);
        manager.Initialize();
        manager.ShowForDesktopAccess();
        PhysicalInputState.SetPhysicalEscapeHandler(() =>
        {
            manager.InterruptImmediately();
            interrupted.Set();
        });
        try
        {
            var beforeSynthetic = PhysicalInputState.Epoch;
            Assert.IsFalse(PhysicalInputState.HandleKeyboardInput(
                0x1B,
                0x0100,
                InputController.SyntheticInputMarker
            ));
            Assert.IsFalse(interrupted.IsSet);
            Assert.AreEqual(beforeSynthetic, PhysicalInputState.Epoch);
            Assert.IsTrue(manager.Status().Visible);

            var stopwatch = Stopwatch.StartNew();
            Assert.IsTrue(PhysicalInputState.HandleKeyboardInput(
                0x1B,
                0x0100,
                IntPtr.Zero
            ));
            Assert.IsTrue(interrupted.IsSet);
            stopwatch.Stop();
            Assert.IsTrue(stopwatch.ElapsedMilliseconds < 250);
            Assert.IsTrue(manager.Status().Windows.All(window => !window.Visible));
        }
        finally
        {
            PhysicalInputState.SetPhysicalEscapeHandler(null);
        }
    }

    private static void RequireInteractiveWindows()
    {
        if (!OperatingSystem.IsWindows() || !Environment.UserInteractive)
        {
            Assert.Inconclusive("Overlay integration tests require an interactive Windows desktop.");
        }
    }
}
