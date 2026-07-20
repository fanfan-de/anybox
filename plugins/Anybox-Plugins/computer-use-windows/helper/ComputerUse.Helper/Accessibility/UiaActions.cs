using System.Globalization;
using System.Text.Json;
using ComputerUse.Helper.Input;
using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.State;
using ComputerUse.Helper.Windows;
using Interop.UIAutomationClient;
using static Interop.UIAutomationClient.UIA_PatternIds;

namespace ComputerUse.Helper.Accessibility;

internal static class UiaActions
{
    public static void Perform(
        WindowInfo window,
        NativeObservationState state,
        JsonElement action
    )
    {
        var type = JsonArgs.String(action, "type", required: true);
        var elementIndex = JsonArgs.Int32(action, "elementIndex");
        var expected = state.GetElement(elementIndex);
        if (state.Accessibility is null)
        {
            throw Stale("The UI Automation revision is missing or stale.");
        }
        var current = UiaSnapshot.FindCurrentElement(window, expected);
        try
        {
            switch (type)
            {
                case "click_element":
                    Click(window, current, expected, action);
                    break;
                case "scroll_element":
                    Scroll(window, current, expected, action);
                    break;
                case "set_value":
                    SetValue(current, expected, JsonArgs.String(action, "value"));
                    break;
                case "perform_secondary_action":
                    Secondary(
                        current,
                        expected,
                        JsonArgs.String(action, "secondaryAction", required: true)
                    );
                    break;
                default:
                    throw new ComputerUseException(
                        "CU_INVALID_ARGUMENT",
                        $"Unsupported UI Automation action: {type}"
                    );
            }
        }
        finally
        {
            UiaSnapshot.Release(current);
        }
    }

    private static void Click(
        WindowInfo window,
        IUIAutomationElement current,
        UiaElementSnapshot expected,
        JsonElement action
    )
    {
        var button = JsonArgs.String(action, "button") is { Length: > 0 } value
            ? value
            : "left";
        var clickCount = Math.Clamp(JsonArgs.Int32(action, "clickCount", 1), 1, 2);
        if (
            button.Equals("left", StringComparison.OrdinalIgnoreCase)
            && clickCount == 1
            && UiaSnapshot.TryPattern<IUIAutomationInvokePattern>(
                current,
                UIA_InvokePatternId,
                out var invoke
            )
        )
        {
            try
            {
                invoke.Invoke();
                return;
            }
            finally
            {
                UiaSnapshot.Release(invoke);
            }
        }
        var point = Center(expected);
        InputController.ClickOwnedPoint(window, point.X, point.Y, button, clickCount);
    }

    private static void Scroll(
        WindowInfo window,
        IUIAutomationElement current,
        UiaElementSnapshot expected,
        JsonElement action
    )
    {
        var deltaX = JsonArgs.Int32(action, "deltaX", 0);
        var deltaY = JsonArgs.Int32(action, "deltaY", 0);
        if (
            UiaSnapshot.TryPattern<IUIAutomationScrollPattern>(
                current,
                UIA_ScrollPatternId,
                out var scroll
            )
            && (deltaX != 0 || deltaY != 0)
        )
        {
            try
            {
                scroll.Scroll(Amount(deltaX), Amount(deltaY));
                return;
            }
            finally
            {
                UiaSnapshot.Release(scroll);
            }
        }
        if (
            UiaSnapshot.TryPattern<IUIAutomationScrollItemPattern>(
                current,
                UIA_ScrollItemPatternId,
                out var scrollItem
            )
        )
        {
            try
            {
                scrollItem.ScrollIntoView();
                return;
            }
            finally
            {
                UiaSnapshot.Release(scrollItem);
            }
        }
        var point = Center(expected);
        InputController.ScrollOwnedPoint(window, point.X, point.Y, deltaY, deltaX);
    }

    private static void SetValue(
        IUIAutomationElement current,
        UiaElementSnapshot expected,
        string value
    )
    {
        if (expected.IsPassword)
        {
            throw new ComputerUseException(
                "CU_APP_BLOCKED",
                "Computer Use does not set values on password or protected input elements."
            );
        }
        if (value.Length > 32_768)
        {
            throw new ComputerUseException(
                "CU_INVALID_ARGUMENT",
                "Value exceeds the 32768 character limit."
            );
        }
        if (
            UiaSnapshot.TryPattern<IUIAutomationValuePattern>(
                current,
                UIA_ValuePatternId,
                out var valuePattern
            )
        )
        {
            try
            {
                if (valuePattern.CurrentIsReadOnly != 0)
                {
                    throw new ComputerUseException(
                        "CU_APP_BLOCKED",
                        "The selected UI Automation value is read-only."
                    );
                }
                valuePattern.SetValue(value);
                return;
            }
            finally
            {
                UiaSnapshot.Release(valuePattern);
            }
        }
        if (
            UiaSnapshot.TryPattern<IUIAutomationRangeValuePattern>(
                current,
                UIA_RangeValuePatternId,
                out var rangePattern
            )
        )
        {
            try
            {
                if (rangePattern.CurrentIsReadOnly != 0)
                {
                    throw new ComputerUseException(
                        "CU_APP_BLOCKED",
                        "The selected UI Automation range is read-only."
                    );
                }
                if (
                    !double.TryParse(
                        value,
                        NumberStyles.Float,
                        CultureInfo.InvariantCulture,
                        out var numeric
                    )
                    || numeric < rangePattern.CurrentMinimum
                    || numeric > rangePattern.CurrentMaximum
                )
                {
                    throw new ComputerUseException(
                        "CU_INVALID_ARGUMENT",
                        "The value is not valid for the selected UI Automation range."
                    );
                }
                rangePattern.SetValue(numeric);
                return;
            }
            finally
            {
                UiaSnapshot.Release(rangePattern);
            }
        }
        throw Stale("The selected element no longer supports a settable value pattern.");
    }

    private static void Secondary(
        IUIAutomationElement current,
        UiaElementSnapshot expected,
        string secondaryAction
    )
    {
        if (!expected.SecondaryActions.Contains(secondaryAction, StringComparer.Ordinal))
        {
            throw new ComputerUseException(
                "CU_APP_BLOCKED",
                "The requested secondary action was not reported by the fresh UI Automation state."
            );
        }
        switch (secondaryAction)
        {
            case "toggle":
                WithPattern<IUIAutomationTogglePattern>(
                    current,
                    UIA_TogglePatternId,
                    pattern => pattern.Toggle()
                );
                break;
            case "select":
                WithPattern<IUIAutomationSelectionItemPattern>(
                    current,
                    UIA_SelectionItemPatternId,
                    pattern => pattern.Select()
                );
                break;
            case "expand":
                WithPattern<IUIAutomationExpandCollapsePattern>(
                    current,
                    UIA_ExpandCollapsePatternId,
                    pattern => pattern.Expand()
                );
                break;
            case "collapse":
                WithPattern<IUIAutomationExpandCollapsePattern>(
                    current,
                    UIA_ExpandCollapsePatternId,
                    pattern => pattern.Collapse()
                );
                break;
            default:
                throw new ComputerUseException(
                    "CU_APP_BLOCKED",
                    "The requested secondary action is not allowlisted."
                );
        }
    }

    private static void WithPattern<T>(
        IUIAutomationElement element,
        int patternId,
        Action<T> operation
    ) where T : class
    {
        if (!UiaSnapshot.TryPattern<T>(element, patternId, out var pattern))
        {
            throw Stale("The selected UI Automation pattern is no longer available.");
        }
        try
        {
            operation(pattern);
        }
        finally
        {
            UiaSnapshot.Release(pattern);
        }
    }

    private static (int X, int Y) Center(UiaElementSnapshot element)
    {
        if (!element.Bounds.IsUsable)
        {
            throw Stale("The selected UI Automation element has no usable bounds.");
        }
        return (
            checked((int)Math.Round(element.Bounds.X + element.Bounds.Width / 2)),
            checked((int)Math.Round(element.Bounds.Y + element.Bounds.Height / 2))
        );
    }

    private static ScrollAmount Amount(int delta)
    {
        return delta switch
        {
            > 0 => ScrollAmount.ScrollAmount_SmallIncrement,
            < 0 => ScrollAmount.ScrollAmount_SmallDecrement,
            _ => ScrollAmount.ScrollAmount_NoAmount,
        };
    }

    private static ComputerUseException Stale(string message)
    {
        return new ComputerUseException(
            "CU_UIA_STALE",
            message,
            retryable: true,
            requiresFreshState: true
        );
    }
}
