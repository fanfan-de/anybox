namespace ComputerUse.Helper.Overlay;

internal enum OverlaySessionPhase
{
    Hidden,
    Visible,
    Unavailable,
    Disposed,
}

internal sealed class OverlaySessionState
{
    internal const long MinimumVisibleMilliseconds = 700;

    private readonly Func<long> _clock;
    private long _visibleSince;

    public OverlaySessionState(Func<long>? clock = null)
    {
        _clock = clock ?? (() => Environment.TickCount64);
    }

    public OverlaySessionPhase Phase { get; private set; } = OverlaySessionPhase.Hidden;

    public bool IsAvailable => Phase is OverlaySessionPhase.Hidden or OverlaySessionPhase.Visible;

    public bool IsVisible => Phase == OverlaySessionPhase.Visible;

    public void MarkVisible()
    {
        AssertAvailable();
        if (Phase == OverlaySessionPhase.Visible)
        {
            return;
        }
        _visibleSince = _clock();
        Phase = OverlaySessionPhase.Visible;
    }

    public TimeSpan RemainingForNormalEnd()
    {
        if (Phase != OverlaySessionPhase.Visible)
        {
            return TimeSpan.Zero;
        }
        var elapsed = Math.Max(0, _clock() - _visibleSince);
        return TimeSpan.FromMilliseconds(
            Math.Max(0, MinimumVisibleMilliseconds - elapsed)
        );
    }

    public void MarkHidden()
    {
        if (Phase is OverlaySessionPhase.Unavailable or OverlaySessionPhase.Disposed)
        {
            return;
        }
        Phase = OverlaySessionPhase.Hidden;
        _visibleSince = 0;
    }

    public void MarkUnavailable()
    {
        if (Phase != OverlaySessionPhase.Disposed)
        {
            Phase = OverlaySessionPhase.Unavailable;
            _visibleSince = 0;
        }
    }

    public void MarkDisposed()
    {
        Phase = OverlaySessionPhase.Disposed;
        _visibleSince = 0;
    }

    public void AssertAvailable()
    {
        if (!IsAvailable)
        {
            throw new InvalidOperationException("The Computer Use safety overlay is unavailable.");
        }
    }
}
