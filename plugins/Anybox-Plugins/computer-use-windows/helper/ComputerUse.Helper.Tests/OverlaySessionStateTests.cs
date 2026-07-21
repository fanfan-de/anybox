using ComputerUse.Helper.Overlay;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ComputerUse.Helper.Tests;

[TestClass]
public sealed class OverlaySessionStateTests
{
    [TestMethod]
    public void VisibleStatePersistsAcrossCallsAndUsesOriginalStartTime()
    {
        long now = 100;
        var state = new OverlaySessionState(() => now);

        state.MarkVisible();
        now = 500;
        state.MarkVisible();

        Assert.IsTrue(state.IsVisible);
        Assert.AreEqual(
            TimeSpan.FromMilliseconds(300),
            state.RemainingForNormalEnd()
        );
    }

    [TestMethod]
    public void NormalEndEnforcesMinimumVisibilityAndThenHides()
    {
        long now = 1_000;
        var state = new OverlaySessionState(() => now);

        state.MarkVisible();
        now += OverlaySessionState.MinimumVisibleMilliseconds - 1;
        Assert.AreEqual(TimeSpan.FromMilliseconds(1), state.RemainingForNormalEnd());
        now += 1;
        Assert.AreEqual(TimeSpan.Zero, state.RemainingForNormalEnd());

        state.MarkHidden();
        Assert.AreEqual(OverlaySessionPhase.Hidden, state.Phase);
    }

    [TestMethod]
    public void PhysicalInterruptionHidesWithoutMinimumDelay()
    {
        long now = 5_000;
        var state = new OverlaySessionState(() => now);

        state.MarkVisible();
        state.MarkHidden();

        Assert.IsFalse(state.IsVisible);
        Assert.AreEqual(TimeSpan.Zero, state.RemainingForNormalEnd());
    }

    [TestMethod]
    public void UnavailableAndDisposedStatesCannotBecomeVisible()
    {
        var unavailable = new OverlaySessionState();
        unavailable.MarkUnavailable();
        Assert.ThrowsException<InvalidOperationException>(unavailable.MarkVisible);

        var disposed = new OverlaySessionState();
        disposed.MarkDisposed();
        Assert.ThrowsException<InvalidOperationException>(disposed.MarkVisible);
    }
}
