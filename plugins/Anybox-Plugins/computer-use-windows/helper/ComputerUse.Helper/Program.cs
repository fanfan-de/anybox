using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    [STAThread]
    public static void Main()
    {
        Console.InputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        SetDpiAwareness();

        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                var id = root.TryGetProperty("id", out var idElement) ? idElement.GetString() ?? "" : "";
                var command = root.TryGetProperty("command", out var commandElement) ? commandElement.GetString() ?? "" : "";
                var parameters = root.TryGetProperty("params", out var paramsElement) ? paramsElement : default;

                var result = command switch
                {
                    "health_check" => HealthCheck(),
                    "list_windows" => ListWindows(),
                    "resolve_window" => ResolveWindow(parameters),
                    "activate_window" => ActivateWindow(parameters),
                    "capture_window" => CaptureWindow(parameters),
                    "send_input" => SendInputCommand(parameters),
                    _ => throw new InvalidOperationException($"Unknown helper command: {command}"),
                };

                WriteJson(new { id, ok = true, result }, Options);
            }
            catch (Exception error)
            {
                var id = TryReadID(line);
                WriteJson(new { id, ok = false, error = error.Message }, Options);
            }
        }
    }

static object HealthCheck()
{
    return new
    {
        platform = "win32",
        helper = "computer-use-helper",
        version = "0.1.1",
        captureBackend = "win32-copy-from-screen",
        inputBackend = "SendInput",
    };
}

static object ListWindows()
{
    var windows = new List<object>();
    EnumWindows((hwnd, _) =>
    {
        if (!IsCandidateWindow(hwnd))
        {
            return true;
        }

        var info = WindowInfo.FromHandle(hwnd);
        if (info is not null)
        {
            windows.Add(info.ToPublicObject());
        }

        return true;
    }, IntPtr.Zero);

    return new { windows };
}

static object ResolveWindow(JsonElement parameters)
{
    var hwnd = GetHwnd(parameters);
    var info = WindowInfo.FromHandle(hwnd) ?? throw new InvalidOperationException("Window is no longer available.");
    return new { window = info.ToPublicObject() };
}

static object ActivateWindow(JsonElement parameters)
{
    var hwnd = GetHwnd(parameters);
    var info = EnsureWindow(hwnd);
    RestoreAndActivate(hwnd);
    Thread.Sleep(80);
    info = WindowInfo.FromHandle(hwnd) ?? info;
    return new { window = info.ToPublicObject() };
}

static object CaptureWindow(JsonElement parameters)
{
    var hwnd = GetHwnd(parameters);
    RestoreAndActivate(hwnd);
    Thread.Sleep(120);

    var info = WindowInfo.FromHandle(hwnd) ?? throw new InvalidOperationException("Window is no longer available.");
    if (info.Bounds.Width <= 0 || info.Bounds.Height <= 0)
    {
        throw new InvalidOperationException("Window has invalid capture bounds.");
    }

    using var bitmap = new Bitmap(info.Bounds.Width, info.Bounds.Height);
    using (var graphics = Graphics.FromImage(bitmap))
    {
        graphics.CopyFromScreen(info.Bounds.Left, info.Bounds.Top, 0, 0, new Size(info.Bounds.Width, info.Bounds.Height), CopyPixelOperation.SourceCopy);
    }

    using var stream = new MemoryStream();
    bitmap.Save(stream, ImageFormat.Png);

    return new
    {
        window = info.ToPublicObject(),
        imageBase64 = Convert.ToBase64String(stream.ToArray()),
        imageWidth = info.Bounds.Width,
        imageHeight = info.Bounds.Height,
        accessibility = (object?)null,
    };
}

static object SendInputCommand(JsonElement parameters)
{
    var hwnd = GetHwnd(parameters);
    var action = GetString(parameters, "action", required: true);
    var info = EnsureWindow(hwnd);
    RestoreAndActivate(hwnd);
    Thread.Sleep(60);

    switch (action)
    {
        case "click":
            Click(info.Bounds, GetInt(parameters, "x"), GetInt(parameters, "y"), GetString(parameters, "button", false) ?? "left", GetInt(parameters, "clickCount", 1));
            break;
        case "scroll":
            Scroll(info.Bounds, GetInt(parameters, "x"), GetInt(parameters, "y"), GetInt(parameters, "deltaY", 0), GetInt(parameters, "deltaX", 0));
            break;
        case "press_key":
            PressKeys(ReadStringArray(parameters, "keys"));
            break;
        case "type_text":
            TypeText(GetString(parameters, "text", required: true));
            break;
        case "drag":
            Drag(info.Bounds, GetInt(parameters, "fromX"), GetInt(parameters, "fromY"), GetInt(parameters, "toX"), GetInt(parameters, "toY"));
            break;
        default:
            throw new InvalidOperationException($"Unsupported input action: {action}");
    }

    return new { ok = true };
}

static WindowInfo EnsureWindow(IntPtr hwnd)
{
    if (!IsWindow(hwnd))
    {
        throw new InvalidOperationException("Window is no longer available.");
    }

    return WindowInfo.FromHandle(hwnd) ?? throw new InvalidOperationException("Window is not controllable.");
}

static void RestoreAndActivate(IntPtr hwnd)
{
    if (IsIconic(hwnd))
    {
        ShowWindowAsync(hwnd, 9);
    }

    SetForegroundWindow(hwnd);
}

static bool IsCandidateWindow(IntPtr hwnd)
{
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || !IsWindowVisible(hwnd))
    {
        return false;
    }

    if (IsCloaked(hwnd))
    {
        return false;
    }

    var title = GetWindowTitle(hwnd);
    if (string.IsNullOrWhiteSpace(title))
    {
        return false;
    }

    if (!TryGetWindowBounds(hwnd, out var bounds) || bounds.Width <= 0 || bounds.Height <= 0)
    {
        return false;
    }

    return true;
}

static bool IsCloaked(IntPtr hwnd)
{
    var cloaked = 0;
    var result = DwmGetWindowAttribute(hwnd, 14, out cloaked, Marshal.SizeOf<int>());
    return result == 0 && cloaked != 0;
}

static string GetWindowTitle(IntPtr hwnd)
{
    var length = GetWindowTextLength(hwnd);
    if (length <= 0)
    {
        return "";
    }

    var builder = new StringBuilder(length + 1);
    GetWindowText(hwnd, builder, builder.Capacity);
    return builder.ToString();
}

static bool TryGetWindowBounds(IntPtr hwnd, out Rect bounds)
{
    if (DwmGetWindowAttribute(hwnd, 9, out RECT extendedFrame, Marshal.SizeOf<RECT>()) == 0 &&
        extendedFrame.Right > extendedFrame.Left &&
        extendedFrame.Bottom > extendedFrame.Top)
    {
        bounds = Rect.FromRECT(extendedFrame);
        return true;
    }

    if (GetWindowRect(hwnd, out var rect))
    {
        bounds = Rect.FromRECT(rect);
        return true;
    }

    bounds = default;
    return false;
}

static Rect GetClientBounds(IntPtr hwnd, Rect windowBounds)
{
    if (!GetClientRect(hwnd, out var clientRect))
    {
        return new Rect(0, 0, windowBounds.Width, windowBounds.Height);
    }

    var topLeft = new POINT { X = 0, Y = 0 };
    ClientToScreen(hwnd, ref topLeft);

    return new Rect(
        topLeft.X - windowBounds.Left,
        topLeft.Y - windowBounds.Top,
        clientRect.Right - clientRect.Left,
        clientRect.Bottom - clientRect.Top
    );
}

static IntPtr GetHwnd(JsonElement parameters)
{
    var raw = GetString(parameters, "hwnd", required: true);
    if (!long.TryParse(raw, out var value))
    {
        throw new InvalidOperationException("Invalid hwnd.");
    }

    return new IntPtr(value);
}

static string GetString(JsonElement parameters, string name, bool required = false)
{
    if (parameters.ValueKind == JsonValueKind.Object &&
        parameters.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String)
    {
        return value.GetString() ?? "";
    }

    if (required)
    {
        throw new InvalidOperationException($"Missing required parameter: {name}");
    }

    return "";
}

static int GetInt(JsonElement parameters, string name, int? fallback = null)
{
    if (parameters.ValueKind == JsonValueKind.Object &&
        parameters.TryGetProperty(name, out var value))
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
        {
            return number;
        }

        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number))
        {
            return number;
        }
    }

    if (fallback.HasValue)
    {
        return fallback.Value;
    }

    throw new InvalidOperationException($"Missing required numeric parameter: {name}");
}

static string[] ReadStringArray(JsonElement parameters, string name)
{
    if (parameters.ValueKind != JsonValueKind.Object ||
        !parameters.TryGetProperty(name, out var value) ||
        value.ValueKind != JsonValueKind.Array)
    {
        throw new InvalidOperationException($"Missing required array parameter: {name}");
    }

    return value.EnumerateArray()
        .Where(item => item.ValueKind == JsonValueKind.String)
        .Select(item => item.GetString() ?? "")
        .Where(item => !string.IsNullOrWhiteSpace(item))
        .ToArray();
}

static void Click(Rect bounds, int x, int y, string button, int clickCount)
{
    var screenX = bounds.Left + x;
    var screenY = bounds.Top + y;
    SetCursorPos(screenX, screenY);
    Thread.Sleep(30);

    var down = button.Equals("right", StringComparison.OrdinalIgnoreCase) ? MouseFlags.RightDown : MouseFlags.LeftDown;
    var up = button.Equals("right", StringComparison.OrdinalIgnoreCase) ? MouseFlags.RightUp : MouseFlags.LeftUp;
    var count = Math.Clamp(clickCount, 1, 2);

    for (var index = 0; index < count; index++)
    {
        SendMouse(down, 0);
        Thread.Sleep(25);
        SendMouse(up, 0);
        Thread.Sleep(80);
    }
}

static void Scroll(Rect bounds, int x, int y, int deltaY, int deltaX)
{
    SetCursorPos(bounds.Left + x, bounds.Top + y);
    Thread.Sleep(30);

    if (deltaY != 0)
    {
        SendMouse(MouseFlags.Wheel, deltaY);
    }

    if (deltaX != 0)
    {
        SendMouse(MouseFlags.HWheel, deltaX);
    }
}

static void Drag(Rect bounds, int fromX, int fromY, int toX, int toY)
{
    var startX = bounds.Left + fromX;
    var startY = bounds.Top + fromY;
    var endX = bounds.Left + toX;
    var endY = bounds.Top + toY;

    SetCursorPos(startX, startY);
    Thread.Sleep(40);
    SendMouse(MouseFlags.LeftDown, 0);
    Thread.Sleep(60);

    const int steps = 18;
    for (var step = 1; step <= steps; step++)
    {
        var x = startX + (endX - startX) * step / steps;
        var y = startY + (endY - startY) * step / steps;
        SetCursorPos(x, y);
        Thread.Sleep(12);
    }

    SendMouse(MouseFlags.LeftUp, 0);
}

static void TypeText(string text)
{
    if (text.Any(character => character > 0x7F))
    {
        PasteText(text);
        return;
    }

    foreach (var character in text)
    {
        SendUnicode(character, keyUp: false);
        SendUnicode(character, keyUp: true);
    }
}

static void PasteText(string text)
{
    var capturedClipboard = TryCaptureClipboard(out var previousClipboard);

    try
    {
        RunClipboardAction(() => System.Windows.Forms.Clipboard.SetText(text, System.Windows.Forms.TextDataFormat.UnicodeText));
        Thread.Sleep(80);
        PressKeys(["ctrl", "v"]);
        Thread.Sleep(400);
    }
    finally
    {
        if (capturedClipboard)
        {
            TryRestoreClipboard(previousClipboard);
        }
    }
}

static bool TryCaptureClipboard(out System.Windows.Forms.IDataObject? data)
{
    try
    {
        data = RunClipboardFunc(System.Windows.Forms.Clipboard.GetDataObject);
        return true;
    }
    catch
    {
        data = null;
        return false;
    }
}

static void TryRestoreClipboard(System.Windows.Forms.IDataObject? data)
{
    try
    {
        if (data is null)
        {
            RunClipboardAction(System.Windows.Forms.Clipboard.Clear);
            return;
        }

        RunClipboardAction(() => System.Windows.Forms.Clipboard.SetDataObject(data, copy: true));
    }
    catch
    {
        // Best-effort clipboard restoration. The typed text is more important than
        // failing the helper after the target app already received input.
    }
}

static T RunClipboardFunc<T>(Func<T> action)
{
    Exception? lastError = null;
    for (var attempt = 0; attempt < 6; attempt++)
    {
        try
        {
            return action();
        }
        catch (ExternalException error)
        {
            lastError = error;
            Thread.Sleep(50);
        }
        catch (InvalidOperationException error)
        {
            lastError = error;
            Thread.Sleep(50);
        }
    }

    throw lastError ?? new InvalidOperationException("Clipboard operation failed.");
}

static void RunClipboardAction(Action action)
{
    RunClipboardFunc(() =>
    {
        action();
        return true;
    });
}

static void PressKeys(string[] keys)
{
    if (keys.Length == 0)
    {
        throw new InvalidOperationException("press_key requires at least one key.");
    }

    var virtualKeys = keys.Select(KeyToVirtualKey).ToArray();
    foreach (var key in virtualKeys)
    {
        SendKey(key, keyUp: false);
    }

    Thread.Sleep(30);

    for (var index = virtualKeys.Length - 1; index >= 0; index--)
    {
        SendKey(virtualKeys[index], keyUp: true);
    }
}

static ushort KeyToVirtualKey(string key)
{
    var normalized = key.Trim().ToLowerInvariant();
    return normalized switch
    {
        "ctrl" or "control" => 0x11,
        "shift" => 0x10,
        "alt" => 0x12,
        "win" or "meta" => 0x5B,
        "enter" or "return" => 0x0D,
        "tab" => 0x09,
        "escape" or "esc" => 0x1B,
        "backspace" => 0x08,
        "delete" or "del" => 0x2E,
        "space" => 0x20,
        "up" or "arrowup" => 0x26,
        "down" or "arrowdown" => 0x28,
        "left" or "arrowleft" => 0x25,
        "right" or "arrowright" => 0x27,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        _ when normalized.Length == 1 => (ushort)char.ToUpperInvariant(normalized[0]),
        _ when normalized.StartsWith('f') && int.TryParse(normalized[1..], out var number) && number is >= 1 and <= 24 => (ushort)(0x70 + number - 1),
        _ => throw new InvalidOperationException($"Unsupported key: {key}"),
    };
}

static void SendMouse(MouseFlags flags, int mouseData)
{
    var input = new INPUT
    {
        type = 0,
        union = new InputUnion
        {
            mi = new MOUSEINPUT
            {
                dwFlags = (uint)flags,
                mouseData = mouseData,
            },
        },
    };

    SendInputs(input);
}

static void SendKey(ushort virtualKey, bool keyUp)
{
    var input = new INPUT
    {
        type = 1,
        union = new InputUnion
        {
            ki = new KEYBDINPUT
            {
                wVk = virtualKey,
                dwFlags = keyUp ? 0x0002u : 0u,
            },
        },
    };

    SendInputs(input);
}

static void SendUnicode(char character, bool keyUp)
{
    var input = new INPUT
    {
        type = 1,
        union = new InputUnion
        {
            ki = new KEYBDINPUT
            {
                wScan = character,
                dwFlags = 0x0004u | (keyUp ? 0x0002u : 0u),
            },
        },
    };

    SendInputs(input);
}

static void SendInputs(INPUT input)
{
    var inputs = new[] { input };
    var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    if (sent != inputs.Length)
    {
        throw new InvalidOperationException("SendInput failed.");
    }
}

static void SetDpiAwareness()
{
    try
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
    }
    catch
    {
        // DPI awareness is a best-effort setup.
    }
}

static string TryReadID(string raw)
{
    try
    {
        using var document = JsonDocument.Parse(raw);
        return document.RootElement.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "";
    }
    catch
    {
        return "";
    }
}

static void WriteJson(object payload, JsonSerializerOptions options)
{
    Console.Out.WriteLine(JsonSerializer.Serialize(payload, options));
    Console.Out.Flush();
}

sealed record WindowInfo(
    string Hwnd,
    int Pid,
    string Title,
    string ProcessName,
    string? ProcessPath,
    Rect Bounds,
    Rect ClientBounds,
    double DpiScale
)
{
    public static WindowInfo? FromHandle(IntPtr hwnd)
    {
        if (!IsWindow(hwnd))
        {
            return null;
        }

        GetWindowThreadProcessId(hwnd, out var pid);
        var title = GetWindowTitle(hwnd);
        if (!TryGetWindowBounds(hwnd, out var bounds))
        {
            return null;
        }

        var processName = "";
        string? processPath = null;
        try
        {
            using var process = Process.GetProcessById((int)pid);
            processName = process.ProcessName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                ? process.ProcessName
                : $"{process.ProcessName}.exe";
            processPath = process.MainModule?.FileName;
        }
        catch
        {
            processName = $"pid-{pid}";
        }

        uint dpi = 96;
        try
        {
            dpi = GetDpiForWindow(hwnd);
        }
        catch
        {
            dpi = 96;
        }

        return new WindowInfo(
            hwnd.ToInt64().ToString(),
            (int)pid,
            title,
            processName,
            processPath,
            bounds,
            GetClientBounds(hwnd, bounds),
            Math.Round(dpi / 96.0, 4)
        );
    }

    public object ToPublicObject()
    {
        return new
        {
            hwnd = Hwnd,
            pid = Pid,
            title = Title,
            processName = ProcessName,
            processPath = ProcessPath,
            bounds = Bounds,
            clientBounds = ClientBounds,
            dpiScale = DpiScale,
        };
    }
}

readonly record struct Rect(int Left, int Top, int Width, int Height)
{
    public static Rect FromRECT(RECT rect)
    {
        return new Rect(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
    }
}

[Flags]
enum MouseFlags : uint
{
    LeftDown = 0x0002,
    LeftUp = 0x0004,
    RightDown = 0x0008,
    RightUp = 0x0010,
    Wheel = 0x0800,
    HWheel = 0x01000,
}

delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

[DllImport("user32.dll")]
static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

[DllImport("user32.dll")]
static extern bool IsWindow(IntPtr hwnd);

[DllImport("user32.dll")]
static extern bool IsWindowVisible(IntPtr hwnd);

[DllImport("user32.dll")]
static extern int GetWindowTextLength(IntPtr hwnd);

[DllImport("user32.dll", CharSet = CharSet.Unicode)]
static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);

[DllImport("user32.dll")]
static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

[DllImport("user32.dll")]
static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

[DllImport("user32.dll")]
static extern bool GetClientRect(IntPtr hwnd, out RECT rect);

[DllImport("user32.dll")]
static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);

[DllImport("user32.dll")]
static extern bool IsIconic(IntPtr hwnd);

[DllImport("user32.dll")]
static extern bool ShowWindowAsync(IntPtr hwnd, int command);

[DllImport("user32.dll")]
static extern bool SetForegroundWindow(IntPtr hwnd);

[DllImport("user32.dll")]
static extern bool SetCursorPos(int x, int y);

[DllImport("user32.dll")]
static extern uint GetDpiForWindow(IntPtr hwnd);

[DllImport("user32.dll")]
static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

[DllImport("user32.dll", SetLastError = true)]
static extern uint SendInput(uint inputCount, INPUT[] inputs, int size);

[DllImport("dwmapi.dll")]
static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT rect, int size);

[DllImport("dwmapi.dll")]
static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

[StructLayout(LayoutKind.Sequential)]
struct RECT
{
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}

[StructLayout(LayoutKind.Sequential)]
struct POINT
{
    public int X;
    public int Y;
}

[StructLayout(LayoutKind.Sequential)]
struct INPUT
{
    public uint type;
    public InputUnion union;
}

[StructLayout(LayoutKind.Explicit)]
struct InputUnion
{
    [FieldOffset(0)]
    public MOUSEINPUT mi;

    [FieldOffset(0)]
    public KEYBDINPUT ki;
}

[StructLayout(LayoutKind.Sequential)]
struct MOUSEINPUT
{
    public int dx;
    public int dy;
    public int mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
struct KEYBDINPUT
{
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
}
}
