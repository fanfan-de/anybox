using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace ComputerUse.Helper.Windows;

internal static class NativeMethods
{
    internal const uint GA_ROOT = 2;
    internal const uint GA_ROOTOWNER = 3;
    internal const int SW_RESTORE = 9;
    internal const int SW_HIDE = 0;
    internal const int SW_SHOWNOACTIVATE = 4;
    internal const int WH_KEYBOARD_LL = 13;
    internal const int WH_MOUSE_LL = 14;
    internal const int GWL_EXSTYLE = -20;
    internal const uint GW_HWNDNEXT = 2;
    internal const long WS_EX_TOPMOST = 0x00000008L;
    internal const long WS_EX_TRANSPARENT = 0x00000020L;
    internal const long WS_EX_TOOLWINDOW = 0x00000080L;
    internal const long WS_EX_LAYERED = 0x00080000L;
    internal const long WS_EX_NOACTIVATE = 0x08000000L;
    internal const uint SWP_NOSIZE = 0x0001;
    internal const uint SWP_NOMOVE = 0x0002;
    internal const uint SWP_NOACTIVATE = 0x0010;
    internal const uint SWP_SHOWWINDOW = 0x0040;
    internal const uint SWP_NOOWNERZORDER = 0x0200;
    internal const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;
    internal const uint WM_QUIT = 0x0012;
    internal const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    internal const uint TH32CS_SNAPPROCESS = 0x00000002;
    internal const uint TOKEN_QUERY = 0x0008;
    internal const int TOKEN_INTEGRITY_LEVEL = 25;
    internal const uint DESKTOP_READOBJECTS = 0x0001;
    internal const uint DESKTOP_SWITCHDESKTOP = 0x0100;
    internal const int SM_XVIRTUALSCREEN = 76;
    internal const int SM_YVIRTUALSCREEN = 77;
    internal const int SM_CXVIRTUALSCREEN = 78;
    internal const int SM_CYVIRTUALSCREEN = 79;
    internal static readonly IntPtr HWND_TOPMOST = new(-1);

    internal delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    internal delegate IntPtr HookProc(int code, UIntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    internal static extern int GetWindowTextLength(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("kernel32.dll")]
    internal static extern uint GetCurrentThreadId();

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    internal static extern IntPtr GetModuleHandle(string? moduleName);

    [DllImport("kernel32.dll")]
    internal static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetNamedPipeClientProcessId(
        SafePipeHandle pipe,
        out uint clientProcessId
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);

    internal static int GetParentProcessId(int processId)
    {
        var snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == new IntPtr(-1))
        {
            return -1;
        }
        try
        {
            var entry = new PROCESSENTRY32
            {
                Size = checked((uint)Marshal.SizeOf<PROCESSENTRY32>()),
            };
            if (!Process32First(snapshot, ref entry))
            {
                return -1;
            }
            do
            {
                if (entry.ProcessId == checked((uint)processId))
                {
                    return checked((int)entry.ParentProcessId);
                }
            } while (Process32Next(snapshot, ref entry));
            return -1;
        }
        finally
        {
            CloseHandle(snapshot);
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool OpenProcessToken(
        IntPtr process,
        uint desiredAccess,
        out IntPtr token
    );

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetTokenInformation(
        IntPtr token,
        int informationClass,
        IntPtr information,
        int informationLength,
        out int returnLength
    );

    [DllImport("advapi32.dll")]
    internal static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    [DllImport("advapi32.dll")]
    internal static extern IntPtr GetSidSubAuthority(IntPtr sid, uint subAuthority);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachState);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetWindowsHookEx(
        int hookId,
        HookProc callback,
        IntPtr module,
        uint threadId
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    internal static extern IntPtr CallNextHookEx(
        IntPtr hook,
        int code,
        UIntPtr wParam,
        IntPtr lParam
    );

    [DllImport("user32.dll")]
    internal static extern int GetMessage(out MSG message, IntPtr hwnd, uint min, uint max);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    internal static extern IntPtr DispatchMessage(ref MSG message);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool PostThreadMessage(
        uint threadId,
        uint message,
        UIntPtr wParam,
        IntPtr lParam
    );

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr OpenInputDesktop(
        uint flags,
        bool inherit,
        uint desiredAccess
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SwitchDesktop(IntPtr desktop);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetClientRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ShowWindowAsync(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool BringWindowToTop(IntPtr hwnd);

    [DllImport("user32.dll")]
    internal static extern IntPtr SetFocus(IntPtr hwnd);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    internal static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    internal static extern IntPtr WindowFromPoint(POINT point);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetWindow(IntPtr hwnd, uint command);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    internal static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(
        IntPtr hwnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    internal static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    internal static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint SendInput(uint inputCount, INPUT[] inputs, int size);

    [DllImport("user32.dll")]
    internal static extern uint GetClipboardSequenceNumber();

    [DllImport("dwmapi.dll")]
    internal static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT rect, int size);

    [DllImport("dwmapi.dll")]
    internal static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
}

[StructLayout(LayoutKind.Sequential)]
internal struct RECT
{
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}

[StructLayout(LayoutKind.Sequential)]
internal struct POINT
{
    public int X;
    public int Y;
}

[StructLayout(LayoutKind.Sequential)]
internal struct INPUT
{
    public uint Type;
    public InputUnion Union;
}

[StructLayout(LayoutKind.Explicit)]
internal struct InputUnion
{
    [FieldOffset(0)]
    public MOUSEINPUT Mouse;

    [FieldOffset(0)]
    public KEYBDINPUT Keyboard;
}

[StructLayout(LayoutKind.Sequential)]
internal struct MOUSEINPUT
{
    public int Dx;
    public int Dy;
    public int MouseData;
    public uint Flags;
    public uint Time;
    public IntPtr ExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
internal struct KEYBDINPUT
{
    public ushort VirtualKey;
    public ushort ScanCode;
    public uint Flags;
    public uint Time;
    public IntPtr ExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
internal struct KBDLLHOOKSTRUCT
{
    public uint VirtualKey;
    public uint ScanCode;
    public uint Flags;
    public uint Time;
    public IntPtr ExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
internal struct MSLLHOOKSTRUCT
{
    public POINT Point;
    public uint MouseData;
    public uint Flags;
    public uint Time;
    public IntPtr ExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
internal struct MSG
{
    public IntPtr Hwnd;
    public uint Message;
    public UIntPtr WParam;
    public IntPtr LParam;
    public uint Time;
    public POINT Point;
    public uint Private;
}

[StructLayout(LayoutKind.Sequential)]
internal struct SID_AND_ATTRIBUTES
{
    public IntPtr Sid;
    public uint Attributes;
}

[StructLayout(LayoutKind.Sequential)]
internal struct TOKEN_MANDATORY_LABEL
{
    public SID_AND_ATTRIBUTES Label;
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
internal struct PROCESSENTRY32
{
    public uint Size;
    public uint Usage;
    public uint ProcessId;
    public UIntPtr DefaultHeapId;
    public uint ModuleId;
    public uint Threads;
    public uint ParentProcessId;
    public int BasePriority;
    public uint Flags;

    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string ExeFile;
}

[Flags]
internal enum MouseFlags : uint
{
    LeftDown = 0x0002,
    LeftUp = 0x0004,
    RightDown = 0x0008,
    RightUp = 0x0010,
    Wheel = 0x0800,
    HWheel = 0x1000,
    Move = 0x0001,
    VirtualDesk = 0x4000,
    Absolute = 0x8000,
}
