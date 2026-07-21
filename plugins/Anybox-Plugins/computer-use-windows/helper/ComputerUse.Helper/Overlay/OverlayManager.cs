using System.ComponentModel;
using ComputerUse.Helper.Protocol;
using Microsoft.Win32;

namespace ComputerUse.Helper.Overlay;

internal sealed record OverlayManagerStatus(
    bool Available,
    bool Visible,
    string? Diagnostic,
    int WindowCount,
    IReadOnlyList<OverlayWindowStatus> Windows
);

internal sealed class OverlayManager : IDisposable
{
    private static readonly TimeSpan StartupTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan UiOperationTimeout = TimeSpan.FromSeconds(3);

    private readonly object _gate = new();
    private readonly Action<ComputerUseException> _fatalFailure;
    private readonly ManualResetEventSlim _ready = new(false);
    private readonly OverlaySessionState _session = new();
    private Thread? _thread;
    private OverlayApplicationContext? _context;
    private Exception? _startupError;
    private string? _diagnostic;
    private bool _initialized;
    private bool _disposing;
    private int _failureReported;

    public OverlayManager(Action<ComputerUseException> fatalFailure)
    {
        _fatalFailure = fatalFailure;
    }

    public bool IsAvailable
    {
        get
        {
            lock (_gate)
            {
                return _initialized && _session.IsAvailable;
            }
        }
    }

    public void Initialize()
    {
        lock (_gate)
        {
            if (_initialized)
            {
                AssertAvailableLocked();
                return;
            }
            if (_thread is not null)
            {
                throw OverlayUnavailable(_startupError);
            }
            _thread = new Thread(RunUiThread)
            {
                IsBackground = true,
                Name = "Anybox Computer Use safety overlay",
            };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
        }

        if (!_ready.Wait(StartupTimeout))
        {
            var error = new TimeoutException("Safety overlay UI startup timed out.");
            ReportFailure(error, startup: true);
            throw OverlayUnavailable(error);
        }

        lock (_gate)
        {
            if (_startupError is not null || _context is null || !_session.IsAvailable)
            {
                throw OverlayUnavailable(_startupError);
            }
            _initialized = true;
        }
    }

    public void ShowForDesktopAccess()
    {
        AssertAvailable();
        try
        {
            InvokeUi(context =>
            {
                context.SynchronizeAndShow();
                return true;
            });
            lock (_gate)
            {
                AssertAvailableLocked();
                _session.MarkVisible();
            }
        }
        catch (Exception error) when (error is not ComputerUseException)
        {
            ReportFailure(error, startup: false);
            throw OverlayUnavailable(error);
        }
    }

    public void AssertAvailable()
    {
        lock (_gate)
        {
            AssertAvailableLocked();
        }
    }

    public void EndTurn()
    {
        TimeSpan remaining;
        lock (_gate)
        {
            remaining = _session.RemainingForNormalEnd();
        }
        if (remaining > TimeSpan.Zero)
        {
            Thread.Sleep(remaining);
        }

        try
        {
            if (IsAvailable)
            {
                InvokeUi(context =>
                {
                    context.HideAll();
                    return true;
                });
            }
        }
        catch (Exception error)
        {
            ReportFailure(error, startup: false);
            OverlayWindowRegistry.HideAllImmediately();
        }
        finally
        {
            lock (_gate)
            {
                _session.MarkHidden();
            }
        }
    }

    public void InterruptImmediately()
    {
        OverlayWindowRegistry.HideAllImmediately();
        lock (_gate)
        {
            _session.MarkHidden();
            _context?.PostHide();
        }
    }

    public OverlayManagerStatus Status()
    {
        lock (_gate)
        {
            if (!_initialized || !_session.IsAvailable || _context is null)
            {
                return new OverlayManagerStatus(
                    Available: false,
                    Visible: false,
                    Diagnostic: _diagnostic ?? "Safety overlay has not initialized.",
                    WindowCount: OverlayWindowRegistry.SnapshotHandles().Length,
                    Windows: Array.Empty<OverlayWindowStatus>()
                );
            }
        }

        try
        {
            var windows = InvokeUi(context => context.Status());
            lock (_gate)
            {
                return new OverlayManagerStatus(
                    Available: _session.IsAvailable,
                    Visible: _session.IsVisible,
                    Diagnostic: _diagnostic,
                    WindowCount: windows.Count,
                    Windows: windows
                );
            }
        }
        catch (Exception error)
        {
            ReportFailure(error, startup: false);
            return new OverlayManagerStatus(
                Available: false,
                Visible: false,
                Diagnostic: _diagnostic,
                WindowCount: OverlayWindowRegistry.SnapshotHandles().Length,
                Windows: Array.Empty<OverlayWindowStatus>()
            );
        }
    }

    internal void SimulateRuntimeFailureForTests()
    {
        ReportFailure(
            new InvalidOperationException("Injected safety overlay failure."),
            startup: false
        );
    }

    public void Dispose()
    {
        Thread? thread;
        OverlayApplicationContext? context;
        lock (_gate)
        {
            if (_disposing)
            {
                return;
            }
            _disposing = true;
            _session.MarkDisposed();
            thread = _thread;
            context = _context;
        }

        OverlayWindowRegistry.HideAllImmediately();
        context?.PostExit();
        if (thread?.IsAlive == true && thread != Thread.CurrentThread)
        {
            thread.Join(TimeSpan.FromSeconds(2));
        }
        _ready.Dispose();
    }

    private void RunUiThread()
    {
        ThreadExceptionEventHandler? threadExceptionHandler = null;
        try
        {
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            threadExceptionHandler = (_, eventArgs) =>
                ReportFailure(eventArgs.Exception, startup: false);
            Application.ThreadException += threadExceptionHandler;

            var context = new OverlayApplicationContext(error =>
                ReportFailure(error, startup: false)
            );
            context.InitializeHidden();
            lock (_gate)
            {
                _context = context;
            }
            _ready.Set();
            Application.Run(context);
            context.Dispose();
        }
        catch (Exception error)
        {
            ReportFailure(error, startup: !_initialized);
        }
        finally
        {
            if (threadExceptionHandler is not null)
            {
                Application.ThreadException -= threadExceptionHandler;
            }
            _ready.Set();
        }
    }

    private T InvokeUi<T>(Func<OverlayApplicationContext, T> operation)
    {
        OverlayApplicationContext context;
        lock (_gate)
        {
            AssertAvailableLocked();
            context = _context ?? throw new InvalidOperationException(
                "Safety overlay UI context is unavailable."
            );
        }
        return context.Invoke(operation, UiOperationTimeout);
    }

    private void AssertAvailableLocked()
    {
        if (!_initialized || !_session.IsAvailable || _context is null)
        {
            throw OverlayUnavailable(_startupError);
        }
    }

    private void ReportFailure(Exception error, bool startup)
    {
        var shouldNotify = false;
        lock (_gate)
        {
            _diagnostic = $"{error.GetType().Name}: {error.Message}";
            _session.MarkUnavailable();
            if (startup)
            {
                _startupError = error;
            }
            shouldNotify = _initialized
                && !_disposing
                && Interlocked.Exchange(ref _failureReported, 1) == 0;
        }
        OverlayWindowRegistry.HideAllImmediately();
        if (shouldNotify)
        {
            try
            {
                _fatalFailure(OverlayUnavailable(error));
            }
            catch
            {
                // A failed transport callback cannot make the overlay available again.
            }
        }
    }

    private static ComputerUseException OverlayUnavailable(Exception? innerException)
    {
        return new ComputerUseException(
            "CU_OVERLAY_UNAVAILABLE",
            "The Computer Use safety overlay is unavailable; desktop access was blocked.",
            retryable: true,
            requiresFreshState: true,
            innerException: innerException
        );
    }
}

internal sealed class OverlayApplicationContext : ApplicationContext
{
    private readonly Action<Exception> _failure;
    private readonly List<OverlayWindow> _windows = new();
    private Control? _dispatcher;
    private string _screenSignature = "";
    private bool _visible;
    private bool _synchronizationQueued;
    private bool _shutdown;

    public OverlayApplicationContext(Action<Exception> failure)
    {
        _failure = failure;
    }

    public void InitializeHidden()
    {
        _dispatcher = new Control();
        _ = _dispatcher.Handle;
        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
        SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
        SynchronizeWindows(force: true);
        if (_windows.Count == 0)
        {
            throw new InvalidOperationException("Windows reported no active displays.");
        }
    }

    public void SynchronizeAndShow()
    {
        SynchronizeWindows(force: false);
        foreach (var window in _windows)
        {
            window.ShowOverlay();
        }
        _visible = true;
    }

    public void HideAll()
    {
        foreach (var window in _windows)
        {
            window.HideOverlay();
        }
        _visible = false;
    }

    public List<OverlayWindowStatus> Status()
    {
        return _windows.Select(window => window.Status()).ToList();
    }

    public T Invoke<T>(Func<OverlayApplicationContext, T> operation, TimeSpan timeout)
    {
        var dispatcher = _dispatcher ?? throw new InvalidOperationException(
            "Safety overlay dispatcher is unavailable."
        );
        if (!dispatcher.InvokeRequired)
        {
            return operation(this);
        }

        using var completed = new ManualResetEventSlim(false);
        T? result = default;
        Exception? failure = null;
        try
        {
            dispatcher.BeginInvoke(new Action(() =>
            {
                try
                {
                    result = operation(this);
                }
                catch (Exception error)
                {
                    failure = error;
                }
                finally
                {
                    completed.Set();
                }
            }));
        }
        catch (Exception error)
        {
            throw new InvalidOperationException(
                "Could not dispatch a safety overlay UI operation.",
                error
            );
        }

        if (!completed.Wait(timeout))
        {
            throw new TimeoutException("Safety overlay UI operation timed out.");
        }
        if (failure is not null)
        {
            throw new InvalidOperationException(
                "Safety overlay UI operation failed.",
                failure
            );
        }
        return result!;
    }

    public void PostHide()
    {
        Post(() => HideAll());
    }

    public void PostExit()
    {
        Post(() =>
        {
            Shutdown();
            ExitThread();
        });
    }

    protected override void ExitThreadCore()
    {
        Shutdown();
        base.ExitThreadCore();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Shutdown();
        }
        base.Dispose(disposing);
    }

    private void SynchronizeWindows(bool force)
    {
        var screens = Screen.AllScreens
            .OrderBy(screen => screen.Bounds.X)
            .ThenBy(screen => screen.Bounds.Y)
            .ToArray();
        var signature = string.Join(
            "|",
            screens.Select(screen =>
                $"{screen.DeviceName}:{screen.Bounds.X},{screen.Bounds.Y},{screen.Bounds.Width},{screen.Bounds.Height}"
            )
        );
        if (!force && signature == _screenSignature)
        {
            foreach (var window in _windows)
            {
                window.RefreshPalette();
            }
            return;
        }

        var replacements = new List<OverlayWindow>(screens.Length);
        try
        {
            foreach (var screen in screens)
            {
                var window = new OverlayWindow(screen, QueueSynchronization);
                window.PrepareHidden();
                if (_visible)
                {
                    window.ShowOverlay();
                }
                replacements.Add(window);
            }
        }
        catch
        {
            foreach (var window in replacements)
            {
                window.HideOverlay();
                window.Dispose();
            }
            throw;
        }

        var previous = _windows.ToArray();
        _windows.Clear();
        _windows.AddRange(replacements);
        _screenSignature = signature;
        foreach (var window in previous)
        {
            window.HideOverlay();
            window.Dispose();
        }
    }

    private void QueueSynchronization()
    {
        if (_shutdown || _synchronizationQueued)
        {
            return;
        }
        _synchronizationQueued = true;
        Post(() =>
        {
            _synchronizationQueued = false;
            try
            {
                SynchronizeWindows(force: false);
                if (_visible)
                {
                    foreach (var window in _windows)
                    {
                        window.ShowOverlay();
                    }
                }
            }
            catch (Exception error)
            {
                _failure(error);
            }
        });
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs eventArgs)
    {
        QueueSynchronization();
    }

    private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs eventArgs)
    {
        QueueSynchronization();
    }

    private void Post(Action action)
    {
        var dispatcher = _dispatcher;
        if (_shutdown || dispatcher is null || dispatcher.IsDisposed)
        {
            return;
        }
        try
        {
            dispatcher.BeginInvoke(action);
        }
        catch (InvalidOperationException)
        {
            // Process shutdown already hides registered HWNDs synchronously.
        }
    }

    private void Shutdown()
    {
        if (_shutdown)
        {
            return;
        }
        _shutdown = true;
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
        foreach (var window in _windows)
        {
            window.HideOverlay();
            window.Dispose();
        }
        _windows.Clear();
        _dispatcher?.Dispose();
        _dispatcher = null;
    }
}
