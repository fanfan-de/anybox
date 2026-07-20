using System.Text;
using System.Text.Json;
using ComputerUse.Helper.Accessibility;
using ComputerUse.Helper.Apps;
using ComputerUse.Helper.Capture;
using ComputerUse.Helper.Input;
using ComputerUse.Helper.Policy;
using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.State;
using ComputerUse.Helper.Windows;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper;

internal static class Program
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    private static bool _initialized;
    private static HostBrokerConnection? _hostBroker;

    [STAThread]
    public static void Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        TrySetDpiAwareness();
        _hostBroker = HostBrokerConnection.TryAccept(args);
        using var hostBroker = _hostBroker;
        var input = hostBroker?.Stream ?? Console.OpenStandardInput();
        var output = hostBroker?.Stream ?? Console.OpenStandardOutput();
        PhysicalInputState.SetPhysicalEscapeHandler(
            hostBroker is null
                ? null
                : () => WriteNotification(output, "physical_escape", new
                {
                    inputEpoch = PhysicalInputState.Epoch,
                })
        );
        using var physicalInputMonitor = PhysicalInputMonitor.Start();

        while (true)
        {
            JsonDocument? document;
            try
            {
                document = FrameProtocol.Read(input);
            }
            catch (ComputerUseException error)
            {
                WriteError(output, null, error);
                break;
            }
            if (document is null)
            {
                break;
            }

            using (document)
            {
                HandleRequest(document.RootElement, output);
            }
        }
        PhysicalInputState.SetPhysicalEscapeHandler(null);
    }

    private static void HandleRequest(JsonElement root, Stream output)
    {
        JsonElement? id = null;
        try
        {
            if (
                root.ValueKind != JsonValueKind.Object
                || JsonArgs.String(root, "jsonrpc") != "2.0"
            )
            {
                throw new ComputerUseException(
                    "CU_PROTOCOL_MISMATCH",
                    "Computer Use helper requires JSON-RPC 2.0."
                );
            }
            var idElement = JsonArgs.Property(root, "id");
            if (idElement.ValueKind is not (JsonValueKind.String or JsonValueKind.Number))
            {
                throw new ComputerUseException(
                    "CU_PROTOCOL_MISMATCH",
                    "Computer Use helper requires a string or numeric request id."
                );
            }
            id = idElement.Clone();
            AssertDeadline(root);
            AssertHostMetadata(root);
            var method = JsonArgs.String(root, "method", required: true);
            var parameters = JsonArgs.PropertyOrDefault(root, "params");
            if (parameters.ValueKind == JsonValueKind.Undefined)
            {
                using var empty = JsonDocument.Parse("{}");
                parameters = empty.RootElement.Clone();
            }

            object result;
            if (method == "initialize")
            {
                result = Initialize(parameters);
                _initialized = true;
            }
            else
            {
                if (!_initialized)
                {
                    throw new ComputerUseException(
                        "CU_PROTOCOL_MISMATCH",
                        "Computer Use helper must be initialized before use."
                    );
                }
                result = Dispatch(method, parameters);
            }
            FrameProtocol.Write(output, new
            {
                jsonrpc = "2.0",
                id,
                result,
            }, SerializerOptions);
        }
        catch (ComputerUseException error)
        {
            WriteError(output, id, error);
        }
        catch (Exception error)
        {
            WriteError(
                output,
                id,
                new ComputerUseException(
                    "CU_INTERNAL_ERROR",
                    "Computer Use helper encountered an internal error.",
                    retryable: true,
                    innerException: error
                )
            );
        }
    }

    private static object Initialize(JsonElement parameters)
    {
        var protocolVersion = JsonArgs.Int32(parameters, "protocolVersion");
        var maxFrameBytes = JsonArgs.Int32(parameters, "maxFrameBytes");
        if (
            protocolVersion != BuildInfo.ProtocolVersion
            || maxFrameBytes != BuildInfo.MaxFrameBytes
        )
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                $"Helper protocol {BuildInfo.ProtocolVersion} is not compatible with the client."
            );
        }
        if (_hostBroker is not null)
        {
            _hostBroker.AssertAndConsumeToken(
                JsonArgs.String(parameters, "brokerToken", required: true)
            );
        }
        return new
        {
            protocolVersion = BuildInfo.ProtocolVersion,
            helperVersion = BuildInfo.HelperVersion,
            minClientVersion = BuildInfo.HelperVersion,
            capabilities = new
            {
                wgc = WgcCapture.IsSupported(),
                uia = UiaSnapshot.IsSupported(),
                listApps = true,
                launchApp = true,
                elementActions = UiaSnapshot.IsSupported(),
                physicalInputEpoch = PhysicalInputState.IsAvailable,
                physicalEscape = _hostBroker is not null,
                hostBroker = _hostBroker is not null,
            },
        };
    }

    private static object Dispatch(string method, JsonElement parameters)
    {
        return method switch
        {
            "health_check" => HealthCheck(),
            "list_apps" => AppCatalog.ListApps(),
            "list_windows" => ListWindows(),
            "resolve_window" => ResolveWindow(parameters),
            "activate_window" => ActivateWindow(parameters),
            "get_window_state" => GetWindowState(parameters),
            "launch_app" => LaunchApp(parameters),
            "perform_action" => InputController.Perform(parameters),
            "end_turn" => EndTurn(),
            _ => throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                $"Unknown Computer Use helper method: {method}"
            ),
        };
    }

    private static object EndTurn()
    {
        NativeStateRegistry.InvalidateAll();
        return new { ended = true };
    }

    private static object HealthCheck()
    {
        return new
        {
            protocolVersion = BuildInfo.ProtocolVersion,
            helperVersion = BuildInfo.HelperVersion,
            platform = "win32-x64",
            captureBackend = "windows-graphics-capture",
            accessibilityBackend = UiaSnapshot.IsSupported() ? "uia" : "unavailable",
            accessibilityDiagnostic = UiaSnapshot.SupportDiagnostic,
            physicalInputDiagnostic = PhysicalInputState.Diagnostic,
            inputBackend = "send-input",
            helperIntegrityLevel = IntegrityInspector.CurrentLevel,
            features = new
            {
                listApps = true,
                launchApp = true,
                elementActions = UiaSnapshot.IsSupported(),
                physicalInputEpoch = PhysicalInputState.IsAvailable,
                physicalEscape = _hostBroker is not null,
                hostBroker = _hostBroker is not null,
            },
        };
    }

    private static object ListWindows()
    {
        var windows = WindowInfo
            .EnumerateCandidates()
            .Select(window => window.ToProtocolObject())
            .ToList();
        return new { windows, inputEpoch = PhysicalInputState.Epoch };
    }

    private static object LaunchApp(JsonElement parameters)
    {
        foreach (var property in parameters.EnumerateObject())
        {
            if (property.Name is not ("catalogRef" or "appId"))
            {
                throw new ComputerUseException(
                    "CU_INVALID_ARGUMENT",
                    "launch_app accepts only catalogRef and appId; paths, arguments, URLs, and commands are forbidden."
                );
            }
        }
        NativeStateRegistry.InvalidateAll();
        return AppCatalog.Launch(
            JsonArgs.String(parameters, "catalogRef", required: true),
            JsonArgs.String(parameters, "appId", required: true)
        );
    }

    private static object ResolveWindow(JsonElement parameters)
    {
        var window = WindowInfo.FromExpected(JsonArgs.Property(parameters, "expectedIdentity"));
        return new
        {
            window = window.ToProtocolObject(),
            inputEpoch = PhysicalInputState.Epoch,
        };
    }

    private static object ActivateWindow(JsonElement parameters)
    {
        DesktopGuard.AssertInteractive();
        var window = WindowInfo.FromExpected(JsonArgs.Property(parameters, "expectedIdentity"));
        TargetPolicy.AssertAllowed(window);
        NativeStateRegistry.InvalidateWindow(window);
        window = WindowGuard.ActivateAndVerify(window);
        return new
        {
            window = window.ToProtocolObject(),
            inputEpoch = PhysicalInputState.Epoch,
        };
    }

    private static object GetWindowState(JsonElement parameters)
    {
        DesktopGuard.AssertInteractive();
        var includeScreenshot = JsonArgs.Boolean(parameters, "includeScreenshot", true);
        var includeAccessibility = JsonArgs.Boolean(parameters, "includeAccessibility", true);
        var includeDocumentText = JsonArgs.Boolean(parameters, "includeDocumentText", false);
        var window = WindowInfo.FromExpected(JsonArgs.Property(parameters, "expectedIdentity"));
        TargetPolicy.AssertAllowed(window);
        if (!includeScreenshot && !includeAccessibility)
        {
            throw new ComputerUseException(
                "CU_INVALID_ARGUMENT",
                "At least one observation backend must be requested."
            );
        }
        CapturedFrame? frame = includeScreenshot ? WgcCapture.Capture(window) : null;
        UiaSnapshot? accessibility = null;
        string? accessibilityStatus = null;
        if (includeAccessibility)
        {
            try
            {
                accessibility = UiaSnapshot.Capture(window, includeDocumentText);
                accessibilityStatus = "ok";
            }
            catch (ComputerUseException)
            {
                accessibilityStatus = "unavailable";
                if (!includeScreenshot)
                {
                    throw;
                }
            }
        }

        var current = WindowInfo.FromExpected(JsonArgs.Property(parameters, "expectedIdentity"));
        if (
            current.Bounds != window.Bounds
            || Math.Abs(current.DpiScale - window.DpiScale) > 0.001
        )
        {
            throw new ComputerUseException(
                "CU_WINDOW_CHANGED",
                "Window bounds or DPI changed during observation.",
                retryable: true,
                requiresFreshState: true
            );
        }
        var inputEpoch = PhysicalInputState.Epoch;
        var nativeState = NativeStateRegistry.Create(
            current,
            inputEpoch,
            frame,
            accessibility
        );
        return new
        {
            window = current.ToProtocolObject(),
            inputEpoch,
            nativeStateRef = nativeState.NativeStateRef,
            screenshot = frame is null
                ? null
                : new
                {
                    imageBase64 = Convert.ToBase64String(frame.Png),
                    width = frame.Width,
                    height = frame.Height,
                    originX = frame.OriginX,
                    originY = frame.OriginY,
                },
            accessibility = accessibility?.ToProtocolObject(),
            accessibilityStatus,
        };
    }

    private static void AssertDeadline(JsonElement root)
    {
        var meta = JsonArgs.PropertyOrDefault(root, "meta");
        var deadline = JsonArgs.PropertyOrDefault(meta, "deadlineUnixMs");
        if (deadline.ValueKind == JsonValueKind.Number && deadline.TryGetInt64(out var unixMs))
        {
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > unixMs)
            {
                throw new ComputerUseException(
                    "CU_TIMEOUT",
                    "Computer Use helper request deadline elapsed.",
                    retryable: true,
                    requiresFreshState: true
                );
            }
        }
    }

    private static void AssertHostMetadata(JsonElement root)
    {
        if (_hostBroker is null || JsonArgs.String(root, "method") == "initialize")
        {
            return;
        }
        var meta = JsonArgs.PropertyOrDefault(root, "meta");
        foreach (var name in new[] { "sessionId", "turnId", "toolCallId" })
        {
            if (string.IsNullOrWhiteSpace(JsonArgs.String(meta, name)))
            {
                throw new ComputerUseException(
                    "CU_PROTOCOL_MISMATCH",
                    $"Computer Use broker request is missing {name} metadata."
                );
            }
        }
    }

    private static void WriteError(Stream output, JsonElement? id, ComputerUseException error)
    {
        try
        {
            FrameProtocol.Write(output, new
            {
                jsonrpc = "2.0",
                id,
                error = new
                {
                    code = -32020,
                    message = error.Message,
                    data = new
                    {
                        computerUseCode = error.Code,
                        retryable = error.Retryable,
                        requiresFreshState = error.RequiresFreshState,
                        effectMayHaveOccurred = error.EffectMayHaveOccurred,
                    },
                },
            }, SerializerOptions);
        }
        catch
        {
            // stdout is the protocol channel. If an error frame cannot be written,
            // terminating is safer than emitting partial or textual diagnostics.
        }
    }

    private static void WriteNotification(Stream output, string method, object parameters)
    {
        FrameProtocol.Write(output, new
        {
            jsonrpc = "2.0",
            method,
            @params = parameters,
        }, SerializerOptions);
    }

    private static void TrySetDpiAwareness()
    {
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
        }
        catch
        {
            // Per-monitor V2 awareness is best effort during startup.
        }
    }
}
