using System.ComponentModel;
using System.Runtime.InteropServices;
using ComputerUse.Helper.Input;
using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.Windows;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper.Windows;

internal sealed class PhysicalInputMonitor : IDisposable
{
    private readonly ManualResetEventSlim _ready = new(false);
    private readonly Thread _thread;
    private IntPtr _keyboardHook;
    private IntPtr _mouseHook;
    private uint _threadId;
    private Exception? _startupError;
    private bool _disposed;

    private PhysicalInputMonitor()
    {
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "Anybox Computer Use physical input monitor",
        };
        _thread.SetApartmentState(ApartmentState.STA);
    }

    public static PhysicalInputMonitor Start()
    {
        var monitor = new PhysicalInputMonitor();
        monitor._thread.Start();
        if (!monitor._ready.Wait(TimeSpan.FromSeconds(2)))
        {
            PhysicalInputState.SetUnavailable("Physical input hook startup timed out.");
            return monitor;
        }
        if (monitor._startupError is not null)
        {
            PhysicalInputState.SetUnavailable(
                $"{monitor._startupError.GetType().Name}: {monitor._startupError.Message}"
            );
        }
        return monitor;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        if (_threadId != 0)
        {
            PostThreadMessage(_threadId, WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
        }
        if (_thread.IsAlive)
        {
            _thread.Join(TimeSpan.FromSeconds(1));
        }
        _ready.Dispose();
    }

    private void Run()
    {
        _threadId = GetCurrentThreadId();
        try
        {
            var module = GetModuleHandle(null);
            _keyboardHook = SetWindowsHookEx(
                WH_KEYBOARD_LL,
                PhysicalInputState.KeyboardCallback,
                module,
                0
            );
            _mouseHook = SetWindowsHookEx(
                WH_MOUSE_LL,
                PhysicalInputState.MouseCallback,
                module,
                0
            );
            if (_keyboardHook == IntPtr.Zero || _mouseHook == IntPtr.Zero)
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Could not install low-level physical input hooks."
                );
            }
            PhysicalInputState.SetAvailable();
        }
        catch (Exception error)
        {
            _startupError = error;
        }
        finally
        {
            _ready.Set();
        }

        if (_startupError is null)
        {
            while (GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
        }
        if (_keyboardHook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_keyboardHook);
            _keyboardHook = IntPtr.Zero;
        }
        if (_mouseHook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_mouseHook);
            _mouseHook = IntPtr.Zero;
        }
    }
}

internal static class PhysicalInputState
{
    private const uint VkEscape = 0x1B;
    private const ulong WmKeyDown = 0x0100;
    private const ulong WmSysKeyDown = 0x0104;
    private static long _epoch;
    private static int _available;
    private static string? _diagnostic = "Physical input monitor has not started.";
    private static Action? _physicalEscapeHandler;
    internal static readonly HookProc KeyboardCallback = OnKeyboard;
    internal static readonly HookProc MouseCallback = OnMouse;

    public static long Epoch => Interlocked.Read(ref _epoch);

    public static bool IsAvailable => Volatile.Read(ref _available) == 1;

    public static string? Diagnostic => _diagnostic;

    public static void SetPhysicalEscapeHandler(Action? handler)
    {
        Volatile.Write(ref _physicalEscapeHandler, handler);
    }

    public static void AssertAvailable()
    {
        if (!IsAvailable)
        {
            throw new ComputerUseException(
                "CU_INTERNAL_ERROR",
                "Physical input monitoring is unavailable; guarded input is disabled."
            );
        }
    }

    internal static void SetAvailable()
    {
        _diagnostic = null;
        Volatile.Write(ref _available, 1);
    }

    internal static void SetUnavailable(string diagnostic)
    {
        _diagnostic = diagnostic;
        Volatile.Write(ref _available, 0);
    }

    private static IntPtr OnKeyboard(int code, UIntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            var input = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(data);
            var physical = Observe(input.ExtraInfo);
            var messageValue = message.ToUInt64();
            if (
                physical
                && input.VirtualKey == VkEscape
                && messageValue is WmKeyDown or WmSysKeyDown
            )
            {
                try
                {
                    Volatile.Read(ref _physicalEscapeHandler)?.Invoke();
                }
                catch
                {
                    // A closed broker transport must never break the input hook.
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    private static IntPtr OnMouse(int code, UIntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            var input = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(data);
            Observe(input.ExtraInfo);
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    private static bool Observe(IntPtr extraInfo)
    {
        if (extraInfo != InputController.SyntheticInputMarker)
        {
            Interlocked.Increment(ref _epoch);
            return true;
        }
        return false;
    }
}
