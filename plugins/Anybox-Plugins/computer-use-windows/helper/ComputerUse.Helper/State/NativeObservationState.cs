using System.Security.Cryptography;
using System.Text.Json;
using ComputerUse.Helper.Accessibility;
using ComputerUse.Helper.Capture;
using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.Windows;

namespace ComputerUse.Helper.State;

internal sealed class NativeObservationState
{
    internal NativeObservationState(
        string nativeStateRef,
        WindowInfo window,
        long inputEpoch,
        CapturedFrame? screenshot,
        UiaSnapshot? accessibility,
        DateTimeOffset createdAt,
        DateTimeOffset expiresAt
    )
    {
        NativeStateRef = nativeStateRef;
        Identity = window.Identity;
        Bounds = window.Bounds;
        DpiScale = window.DpiScale;
        InputEpoch = inputEpoch;
        ImageWidth = screenshot?.Width ?? 0;
        ImageHeight = screenshot?.Height ?? 0;
        Accessibility = accessibility;
        CreatedAt = createdAt;
        ExpiresAt = expiresAt;
    }

    public string NativeStateRef { get; }

    public WindowIdentity Identity { get; }

    public Rect Bounds { get; }

    public double DpiScale { get; }

    public long InputEpoch { get; }

    public int ImageWidth { get; }

    public int ImageHeight { get; }

    public UiaSnapshot? Accessibility { get; }

    public DateTimeOffset CreatedAt { get; }

    public DateTimeOffset ExpiresAt { get; }

    public bool Consumed { get; set; }

    public bool Invalidated { get; set; }

    public void AssertMatches(WindowInfo current, JsonElement parameters)
    {
        var observedBounds = Rect.FromJson(JsonArgs.Property(parameters, "observedBounds"));
        var observedDpiScale = JsonArgs.Double(parameters, "observedDpiScale");
        var observedInputEpoch = JsonArgs.PropertyOrDefault(parameters, "observedInputEpoch")
            .TryGetInt64(out var parsedEpoch) ? parsedEpoch : 0;
        var imageWidth = JsonArgs.Int32(parameters, "imageWidth", 0);
        var imageHeight = JsonArgs.Int32(parameters, "imageHeight", 0);
        if (
            current.Identity != Identity
            || observedBounds != Bounds
            || Math.Abs(observedDpiScale - DpiScale) > 0.001
            || observedInputEpoch != InputEpoch
            || imageWidth != ImageWidth
            || imageHeight != ImageHeight
        )
        {
            throw new ComputerUseException(
                "CU_WINDOW_CHANGED",
                "The native observation state does not match the selected window.",
                retryable: true,
                requiresFreshState: true
            );
        }
        var requestedRevision = JsonArgs.String(parameters, "accessibilityRevision");
        if (
            requestedRevision.Length > 0
            && !string.Equals(
                requestedRevision,
                Accessibility?.Revision,
                StringComparison.Ordinal
            )
        )
        {
            throw new ComputerUseException(
                "CU_UIA_STALE",
                "The UI Automation revision does not match the native observation.",
                retryable: true,
                requiresFreshState: true
            );
        }
        Accessibility?.AssertCurrent(current);
    }

    public UiaElementSnapshot GetElement(int elementIndex)
    {
        if (Accessibility is null)
        {
            throw new ComputerUseException(
                "CU_UIA_STALE",
                "This observation does not contain UI Automation state.",
                retryable: true,
                requiresFreshState: true
            );
        }
        return Accessibility.GetElement(elementIndex);
    }
}

internal static class NativeStateRegistry
{
    private static readonly TimeSpan StateTtl = TimeSpan.FromSeconds(30);
    private static readonly Dictionary<string, NativeObservationState> States = new(
        StringComparer.Ordinal
    );

    public static NativeObservationState Create(
        WindowInfo window,
        long inputEpoch,
        CapturedFrame? screenshot,
        UiaSnapshot? accessibility
    )
    {
        Cleanup();
        foreach (var existing in States.Values)
        {
            if (
                existing.Identity.Hwnd == window.Identity.Hwnd
                && existing.Identity.Pid == window.Identity.Pid
            )
            {
                existing.Invalidated = true;
            }
        }
        var createdAt = DateTimeOffset.UtcNow;
        var state = new NativeObservationState(
            MakeRef(),
            window,
            inputEpoch,
            screenshot,
            accessibility,
            createdAt,
            createdAt + StateTtl
        );
        States[state.NativeStateRef] = state;
        return state;
    }

    public static NativeObservationState Consume(string nativeStateRef)
    {
        Cleanup();
        if (
            string.IsNullOrWhiteSpace(nativeStateRef)
            || !States.TryGetValue(nativeStateRef, out var state)
            || state.Invalidated
            || DateTimeOffset.UtcNow > state.ExpiresAt
        )
        {
            throw new ComputerUseException(
                "CU_STATE_EXPIRED",
                "The native observation state expired. Capture a fresh state before acting.",
                retryable: true,
                requiresFreshState: true
            );
        }
        if (state.Consumed)
        {
            throw new ComputerUseException(
                "CU_STATE_CONSUMED",
                "The native observation state already performed an action.",
                retryable: true,
                requiresFreshState: true
            );
        }

        // Consume before any target revalidation or action. A failed action must
        // never leave a native state token reusable.
        state.Consumed = true;
        foreach (var sibling in States.Values)
        {
            if (
                !ReferenceEquals(sibling, state)
                && sibling.Identity.Hwnd == state.Identity.Hwnd
                && sibling.Identity.Pid == state.Identity.Pid
            )
            {
                sibling.Invalidated = true;
            }
        }
        return state;
    }

    public static void InvalidateWindow(WindowInfo window)
    {
        foreach (var state in States.Values)
        {
            if (
                state.Identity.Hwnd == window.Identity.Hwnd
                && state.Identity.Pid == window.Identity.Pid
            )
            {
                state.Invalidated = true;
            }
        }
    }

    public static void InvalidateAll()
    {
        foreach (var state in States.Values)
        {
            state.Invalidated = true;
        }
    }

    private static void Cleanup()
    {
        var cutoff = DateTimeOffset.UtcNow - StateTtl;
        foreach (
            var key in States
                .Where(entry => entry.Value.ExpiresAt < cutoff)
                .Select(entry => entry.Key)
                .ToArray()
        )
        {
            States.Remove(key);
        }
    }

    private static string MakeRef()
    {
        return $"native_{Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant()}";
    }
}
