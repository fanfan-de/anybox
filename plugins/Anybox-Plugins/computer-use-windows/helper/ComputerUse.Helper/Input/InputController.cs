using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using ComputerUse.Helper.Accessibility;
using ComputerUse.Helper.Policy;
using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.State;
using ComputerUse.Helper.Windows;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper.Input;

internal static class InputController
{
    private const uint KeyUpFlag = 0x0002;
    private const uint UnicodeFlag = 0x0004;
    private static readonly IntPtr InputMarker = CreateInputMarker();

    internal static IntPtr SyntheticInputMarker => InputMarker;

    public static object Perform(JsonElement parameters)
    {
        PhysicalInputState.AssertAvailable();
        DesktopGuard.AssertInteractive();
        var nativeState = NativeStateRegistry.Consume(
            JsonArgs.String(parameters, "nativeStateRef", required: true)
        );
        var expectedIdentity = JsonArgs.Property(parameters, "expectedIdentity");
        var current = WindowInfo.FromExpected(expectedIdentity);
        TargetPolicy.AssertAllowed(current);
        var observedBounds = Rect.FromJson(JsonArgs.Property(parameters, "observedBounds"));
        var observedDpiScale = JsonArgs.Double(parameters, "observedDpiScale");
        var observedInputEpoch = JsonArgs.PropertyOrDefault(parameters, "observedInputEpoch").TryGetInt64(
            out var parsedEpoch
        ) ? parsedEpoch : 0;
        var imageWidth = JsonArgs.Int32(parameters, "imageWidth", 0);
        var imageHeight = JsonArgs.Int32(parameters, "imageHeight", 0);
        nativeState.AssertMatches(current, parameters);
        WindowGuard.AssertObservedState(current, observedBounds, observedDpiScale, observedInputEpoch);

        var action = JsonArgs.Property(parameters, "action");
        var type = JsonArgs.String(action, "type", required: true);
        if (
            type is
                "click_element" or
                "scroll_element" or
                "set_value" or
                "perform_secondary_action"
        )
        {
            var mode = UiaActions.TryPerformSemantic(current, nativeState, action);
            if (mode == UiaActionMode.Semantic)
            {
                return new
                {
                    ok = true,
                    inputEpoch = PhysicalInputState.Epoch,
                    inputMode = "uia",
                };
            }
            current = WindowGuard.ActivateAndVerify(current);
            WindowGuard.AssertObservedState(
                current,
                observedBounds,
                observedDpiScale,
                observedInputEpoch
            );
            UiaActions.PerformPhysicalFallback(current, nativeState, action);
            return new
            {
                ok = true,
                inputEpoch = PhysicalInputState.Epoch,
                inputMode = "physical",
            };
        }

        current = WindowGuard.ActivateAndVerify(current);
        WindowGuard.AssertObservedState(current, observedBounds, observedDpiScale, observedInputEpoch);
        var focusValidated = false;
        switch (type)
        {
            case "click":
                Click(
                    current,
                    imageWidth,
                    imageHeight,
                    JsonArgs.Int32(action, "x"),
                    JsonArgs.Int32(action, "y"),
                    JsonArgs.String(action, "button") is { Length: > 0 } button ? button : "left",
                    JsonArgs.Int32(action, "clickCount", 1)
                );
                break;
            case "scroll":
                Scroll(
                    current,
                    imageWidth,
                    imageHeight,
                    JsonArgs.Int32(action, "x"),
                    JsonArgs.Int32(action, "y"),
                    JsonArgs.Int32(action, "deltaY"),
                    JsonArgs.Int32(action, "deltaX", 0)
                );
                break;
            case "press_key":
                PressKeys(JsonArgs.StringArray(action, "keys", 4));
                break;
            case "type_text":
                var text = JsonArgs.String(action, "text");
                if (nativeState.Accessibility is not null)
                {
                    nativeState.Accessibility.AssertFocusedElementAcceptsTextInput(current);
                    focusValidated = true;
                }
                if (text.Length > 32768)
                {
                    throw new ComputerUseException(
                        "CU_INVALID_ARGUMENT",
                        "Text exceeds the 32768 character limit."
                    );
                }
                TypeText(text);
                break;
            case "drag":
                Drag(
                    current,
                    imageWidth,
                    imageHeight,
                    JsonArgs.Int32(action, "fromX"),
                    JsonArgs.Int32(action, "fromY"),
                    JsonArgs.Int32(action, "toX"),
                    JsonArgs.Int32(action, "toY")
                );
                break;
            default:
                throw new ComputerUseException(
                    "CU_INVALID_ARGUMENT",
                    $"Unsupported input action: {type}"
                );
        }
        if (type == "type_text")
        {
            return new
            {
                ok = true,
                inputEpoch = PhysicalInputState.Epoch,
                inputMode = "physical",
                focusValidated,
            };
        }
        return new
        {
            ok = true,
            inputEpoch = PhysicalInputState.Epoch,
            inputMode = "physical",
        };
    }

    private static (int X, int Y) ToScreen(
        WindowInfo window,
        int imageWidth,
        int imageHeight,
        int x,
        int y
    )
    {
        if (
            imageWidth <= 0
            || imageHeight <= 0
            || x < 0
            || y < 0
            || x >= imageWidth
            || y >= imageHeight
        )
        {
            throw new ComputerUseException(
                "CU_POINT_OUTSIDE_TARGET",
                "Input coordinates are outside the observed screenshot.",
                retryable: true,
                requiresFreshState: true
            );
        }
        var screenX = window.Bounds.X + (int)Math.Round((double)x * window.Bounds.Width / imageWidth);
        var screenY = window.Bounds.Y + (int)Math.Round((double)y * window.Bounds.Height / imageHeight);
        WindowGuard.AssertPointOwnedBy(window, screenX, screenY);
        return (screenX, screenY);
    }

    private static void Click(
        WindowInfo window,
        int imageWidth,
        int imageHeight,
        int x,
        int y,
        string button,
        int clickCount
    )
    {
        var point = ToScreen(window, imageWidth, imageHeight, x, y);
        ClickOwnedPoint(window, point.X, point.Y, button, clickCount);
    }

    internal static void ClickOwnedPoint(
        WindowInfo window,
        int screenX,
        int screenY,
        string button,
        int clickCount
    )
    {
        WindowGuard.AssertPointOwnedBy(window, screenX, screenY);
        MovePointer(screenX, screenY);
        Thread.Sleep(25);
        var right = button.Equals("right", StringComparison.OrdinalIgnoreCase);
        if (!right && !button.Equals("left", StringComparison.OrdinalIgnoreCase))
        {
            throw new ComputerUseException("CU_INVALID_ARGUMENT", $"Unsupported mouse button: {button}");
        }
        var down = right ? MouseFlags.RightDown : MouseFlags.LeftDown;
        var up = right ? MouseFlags.RightUp : MouseFlags.LeftUp;
        var count = Math.Clamp(clickCount, 1, 2);
        for (var index = 0; index < count; index++)
        {
            var held = false;
            try
            {
                SendMouse(down, 0);
                held = true;
                Thread.Sleep(25);
                SendMouse(up, 0);
                held = false;
                Thread.Sleep(75);
            }
            finally
            {
                if (held)
                {
                    TrySendMouse(up, 0);
                }
            }
        }
    }

    private static void Scroll(
        WindowInfo window,
        int imageWidth,
        int imageHeight,
        int x,
        int y,
        int deltaY,
        int deltaX
    )
    {
        var point = ToScreen(window, imageWidth, imageHeight, x, y);
        ScrollOwnedPoint(window, point.X, point.Y, deltaY, deltaX);
    }

    internal static void ScrollOwnedPoint(
        WindowInfo window,
        int screenX,
        int screenY,
        int deltaY,
        int deltaX
    )
    {
        WindowGuard.AssertPointOwnedBy(window, screenX, screenY);
        MovePointer(screenX, screenY);
        Thread.Sleep(25);
        if (deltaY != 0)
        {
            SendMouse(MouseFlags.Wheel, deltaY);
        }
        if (deltaX != 0)
        {
            SendMouse(MouseFlags.HWheel, deltaX);
        }
    }

    private static void Drag(
        WindowInfo window,
        int imageWidth,
        int imageHeight,
        int fromX,
        int fromY,
        int toX,
        int toY
    )
    {
        var start = ToScreen(window, imageWidth, imageHeight, fromX, fromY);
        var end = ToScreen(window, imageWidth, imageHeight, toX, toY);
        MovePointer(start.X, start.Y);
        var held = false;
        try
        {
            Thread.Sleep(35);
            SendMouse(MouseFlags.LeftDown, 0);
            held = true;
            const int steps = 18;
            for (var step = 1; step <= steps; step++)
            {
                var x = start.X + (end.X - start.X) * step / steps;
                var y = start.Y + (end.Y - start.Y) * step / steps;
                MovePointer(x, y);
                Thread.Sleep(12);
            }
            SendMouse(MouseFlags.LeftUp, 0);
            held = false;
        }
        finally
        {
            if (held)
            {
                TrySendMouse(MouseFlags.LeftUp, 0);
            }
        }
    }

    private static void TypeText(string text)
    {
        if (text.Any(character => character > 0x7f))
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

    private static void PasteText(string text)
    {
        var captured = TryCaptureClipboard(out var previous);
        uint temporarySequence = 0;
        try
        {
            RunClipboardAction(() =>
                System.Windows.Forms.Clipboard.SetText(
                    text,
                    System.Windows.Forms.TextDataFormat.UnicodeText
                )
            );
            temporarySequence = GetClipboardSequenceNumber();
            Thread.Sleep(60);
            PressKeys(["ctrl", "v"]);
            Thread.Sleep(300);
        }
        finally
        {
            if (
                captured
                && temporarySequence != 0
                && GetClipboardSequenceNumber() == temporarySequence
            )
            {
                TryRestoreClipboard(previous);
            }
        }
    }

    private static bool TryCaptureClipboard(out System.Windows.Forms.IDataObject? value)
    {
        try
        {
            value = RunClipboardFunc(System.Windows.Forms.Clipboard.GetDataObject);
            return true;
        }
        catch
        {
            value = null;
            return false;
        }
    }

    private static void TryRestoreClipboard(System.Windows.Forms.IDataObject? value)
    {
        try
        {
            if (value is null)
            {
                RunClipboardAction(System.Windows.Forms.Clipboard.Clear);
            }
            else
            {
                RunClipboardAction(() => System.Windows.Forms.Clipboard.SetDataObject(value, copy: true));
            }
        }
        catch
        {
            // Clipboard restoration is best effort and never logs clipboard data.
        }
    }

    private static T RunClipboardFunc<T>(Func<T> operation)
    {
        Exception? lastError = null;
        for (var attempt = 0; attempt < 6; attempt++)
        {
            try
            {
                return operation();
            }
            catch (Exception error) when (error is ExternalException or InvalidOperationException)
            {
                lastError = error;
                Thread.Sleep(50);
            }
        }
        throw lastError ?? new InvalidOperationException("Clipboard operation failed.");
    }

    private static void RunClipboardAction(Action operation)
    {
        RunClipboardFunc(() =>
        {
            operation();
            return true;
        });
    }

    private static void PressKeys(string[] keys)
    {
        var normalized = keys.Select(key => key.Trim().ToLowerInvariant()).ToArray();
        if (normalized.Any(key => key is "win" or "meta"))
        {
            throw new ComputerUseException("CU_APP_BLOCKED", "Windows-key shortcuts are blocked.");
        }
        if (
            normalized.Contains("ctrl")
            && normalized.Contains("alt")
            && normalized.Contains("delete")
        )
        {
            throw new ComputerUseException("CU_APP_BLOCKED", "The requested security shortcut is blocked.");
        }

        var virtualKeys = normalized.Select(KeyToVirtualKey).ToArray();
        var pressed = new List<ushort>(virtualKeys.Length);
        try
        {
            foreach (var key in virtualKeys)
            {
                SendKey(key, keyUp: false);
                pressed.Add(key);
            }
            Thread.Sleep(30);
        }
        finally
        {
            for (var index = pressed.Count - 1; index >= 0; index--)
            {
                TrySendKey(pressed[index], keyUp: true);
            }
        }
    }

    private static ushort KeyToVirtualKey(string key)
    {
        return key switch
        {
            "ctrl" or "control" => 0x11,
            "shift" => 0x10,
            "alt" => 0x12,
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
            _ when key.Length == 1 => (ushort)char.ToUpperInvariant(key[0]),
            _ when key.StartsWith('f')
                && int.TryParse(key[1..], out var number)
                && number is >= 1 and <= 24 => (ushort)(0x70 + number - 1),
            _ => throw new ComputerUseException("CU_INVALID_ARGUMENT", $"Unsupported key: {key}"),
        };
    }

    private static void SendMouse(MouseFlags flags, int mouseData)
    {
        SendInputs(new INPUT
        {
            Type = 0,
            Union = new InputUnion
            {
                Mouse = new MOUSEINPUT
                {
                    Flags = (uint)flags,
                    MouseData = mouseData,
                    ExtraInfo = InputMarker,
                },
            },
        });
    }

    private static void MovePointer(int screenX, int screenY)
    {
        var virtualX = GetSystemMetrics(SM_XVIRTUALSCREEN);
        var virtualY = GetSystemMetrics(SM_YVIRTUALSCREEN);
        var virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        var virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if (
            virtualWidth <= 1
            || virtualHeight <= 1
            || screenX < virtualX
            || screenY < virtualY
            || screenX >= virtualX + virtualWidth
            || screenY >= virtualY + virtualHeight
        )
        {
            throw new ComputerUseException(
                "CU_POINT_OUTSIDE_TARGET",
                "The requested point is outside the interactive virtual desktop.",
                retryable: true,
                requiresFreshState: true
            );
        }
        var normalizedX = checked((int)Math.Round(
            (double)(screenX - virtualX) * 65_535 / (virtualWidth - 1)
        ));
        var normalizedY = checked((int)Math.Round(
            (double)(screenY - virtualY) * 65_535 / (virtualHeight - 1)
        ));
        SendInputs(new INPUT
        {
            Type = 0,
            Union = new InputUnion
            {
                Mouse = new MOUSEINPUT
                {
                    Dx = normalizedX,
                    Dy = normalizedY,
                    Flags = (uint)(
                        MouseFlags.Move
                        | MouseFlags.Absolute
                        | MouseFlags.VirtualDesk
                    ),
                    ExtraInfo = InputMarker,
                },
            },
        });
    }

    private static void TrySendMouse(MouseFlags flags, int mouseData)
    {
        try
        {
            SendMouse(flags, mouseData);
        }
        catch
        {
            // A best-effort release is safer than masking the original failure.
        }
    }

    private static void SendKey(ushort virtualKey, bool keyUp)
    {
        SendInputs(new INPUT
        {
            Type = 1,
            Union = new InputUnion
            {
                Keyboard = new KEYBDINPUT
                {
                    VirtualKey = virtualKey,
                    Flags = keyUp ? KeyUpFlag : 0,
                    ExtraInfo = InputMarker,
                },
            },
        });
    }

    private static void TrySendKey(ushort virtualKey, bool keyUp)
    {
        try
        {
            SendKey(virtualKey, keyUp);
        }
        catch
        {
            // A best-effort release is safer than masking the original failure.
        }
    }

    private static void SendUnicode(char character, bool keyUp)
    {
        SendInputs(new INPUT
        {
            Type = 1,
            Union = new InputUnion
            {
                Keyboard = new KEYBDINPUT
                {
                    ScanCode = character,
                    Flags = UnicodeFlag | (keyUp ? KeyUpFlag : 0),
                    ExtraInfo = InputMarker,
                },
            },
        });
    }

    private static void SendInputs(INPUT input)
    {
        var inputs = new[] { input };
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        if (sent != (uint)inputs.Length)
        {
            throw new ComputerUseException(
                "CU_INTERNAL_ERROR",
                "Windows SendInput did not accept the complete input sequence."
            );
        }
    }

    private static IntPtr CreateInputMarker()
    {
        // Keep the random marker within 31 bits so it survives providers which
        // marshal ULONG_PTR through a 32-bit compatibility boundary.
        return new IntPtr(RandomNumberGenerator.GetInt32(1, int.MaxValue));
    }
}
