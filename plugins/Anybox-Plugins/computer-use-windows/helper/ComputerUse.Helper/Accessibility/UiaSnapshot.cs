using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.Windows;
using Interop.UIAutomationClient;
using static Interop.UIAutomationClient.UIA_ControlTypeIds;
using static Interop.UIAutomationClient.UIA_PatternIds;

namespace ComputerUse.Helper.Accessibility;

internal sealed record UiaRect(double X, double Y, double Width, double Height)
{
    public bool IsUsable =>
        double.IsFinite(X)
        && double.IsFinite(Y)
        && double.IsFinite(Width)
        && double.IsFinite(Height)
        && Width > 0
        && Height > 0;

    public bool NearlyEquals(UiaRect other, double tolerance = 2)
    {
        return Math.Abs(X - other.X) <= tolerance
            && Math.Abs(Y - other.Y) <= tolerance
            && Math.Abs(Width - other.Width) <= tolerance
            && Math.Abs(Height - other.Height) <= tolerance;
    }
}

internal sealed record UiaElementSnapshot(
    int Index,
    int[] RuntimeId,
    string Name,
    string AutomationId,
    string ControlType,
    string ClassName,
    string FrameworkId,
    UiaRect Bounds,
    bool IsEnabled,
    bool IsOffscreen,
    bool IsKeyboardFocusable,
    bool HasKeyboardFocus,
    bool IsPassword,
    string? Value,
    string[] States,
    string[] Patterns,
    string[] SecondaryActions
);

internal sealed class UiaSnapshot
{
    private const int MaxDepth = 32;
    private const int MaxNodes = 2_000;
    private const int MaxPropertyChars = 4 * 1024;
    private const int MaxTreeChars = 256 * 1024;
    private const int MaxDocumentTextChars = 64 * 1024;
    private static readonly Lazy<(IUIAutomation? Automation, string? Diagnostic)> Runtime = new(
        CreateRuntime
    );
    private readonly Dictionary<int, UiaElementSnapshot> _elements;

    private UiaSnapshot(
        string revision,
        string tree,
        Dictionary<int, UiaElementSnapshot> elements,
        int? focusedElement,
        string? selectedText,
        int[] selectedElements,
        string? documentText,
        bool truncated,
        string fingerprint
    )
    {
        Revision = revision;
        Tree = tree;
        _elements = elements;
        FocusedElement = focusedElement;
        SelectedText = selectedText;
        SelectedElements = selectedElements;
        DocumentText = documentText;
        Truncated = truncated;
        Fingerprint = fingerprint;
    }

    public string Revision { get; }

    public string Tree { get; }

    public int? FocusedElement { get; }

    public string? SelectedText { get; }

    public int[] SelectedElements { get; }

    public string? DocumentText { get; }

    public bool Truncated { get; }

    public string Fingerprint { get; }

    public IReadOnlyCollection<int> ElementIndexes => _elements.Keys;

    public static bool IsSupported()
    {
        return Runtime.Value.Automation is not null;
    }

    public static string? SupportDiagnostic => Runtime.Value.Diagnostic;

    private static IUIAutomation Automation => Runtime.Value.Automation
        ?? throw new ComputerUseException(
            "CU_UNSUPPORTED_PLATFORM",
            $"UI Automation is unavailable: {SupportDiagnostic ?? "unknown error"}"
        );

    public static UiaSnapshot Capture(WindowInfo window, bool includeDocumentText)
    {
        try
        {
            var root = Automation.ElementFromHandle(window.Handle);
            if (root is null)
            {
                throw new ComputerUseException(
                    "CU_INTERNAL_ERROR",
                    "UI Automation could not resolve the selected window.",
                    retryable: true,
                    requiresFreshState: true
                );
            }

            var builder = new StringBuilder(Math.Min(MaxTreeChars, 32 * 1024));
            var elements = new Dictionary<int, UiaElementSnapshot>();
            var runtimeToIndex = new Dictionary<string, int>(StringComparer.Ordinal);
            var selected = new List<int>();
            int? focused = null;
            string? selectedText = null;
            string? documentText = null;
            var truncated = false;
            var visited = 0;
            var pending = new Stack<PendingElement>();
            pending.Push(new PendingElement(root, 0, 0, true));

            while (pending.Count > 0)
            {
                if (visited >= MaxNodes)
                {
                    truncated = true;
                    ReleasePending(pending);
                    break;
                }
                var pendingElement = pending.Pop();
                if (pendingElement.TraversalDepth > MaxDepth)
                {
                    truncated = true;
                    Release(pendingElement.Element);
                    continue;
                }
                visited += 1;

                if (!TryReadElement(pendingElement.Element, elements.Count, out var element))
                {
                    Release(pendingElement.Element);
                    continue;
                }
                var runtimeKey = RuntimeKey(element.RuntimeId);
                if (runtimeToIndex.ContainsKey(runtimeKey))
                {
                    Release(pendingElement.Element);
                    continue;
                }
                var include = pendingElement.IsRoot || ShouldInclude(element);
                var childDisplayDepth = pendingElement.DisplayDepth;
                if (include)
                {
                    var line = FormatTreeLine(element, pendingElement.DisplayDepth);
                    if (builder.Length + line.Length > MaxTreeChars)
                    {
                        truncated = true;
                        Release(pendingElement.Element);
                        ReleasePending(pending);
                        break;
                    }
                    builder.Append(line);
                    elements[element.Index] = element;
                    runtimeToIndex[runtimeKey] = element.Index;
                    childDisplayDepth += 1;
                    if (element.HasKeyboardFocus)
                    {
                        focused = element.Index;
                    }
                    if (element.States.Contains("selected", StringComparer.Ordinal))
                    {
                        selected.Add(element.Index);
                    }
                    if (
                        includeDocumentText
                        && documentText is null
                        && !element.IsPassword
                        && element.ControlType is "document" or "edit"
                    )
                    {
                        documentText = TryReadDocumentText(pendingElement.Element);
                    }
                    if (
                        element.HasKeyboardFocus
                        && !element.IsPassword
                        && HasPattern(element, "Text")
                    )
                    {
                        selectedText = TryReadSelectedText(pendingElement.Element);
                    }
                }

                var children = ReadChildren(pendingElement.Element, MaxNodes - visited);
                for (var index = children.Count - 1; index >= 0; index--)
                {
                    pending.Push(new PendingElement(
                        children[index],
                        pendingElement.TraversalDepth + 1,
                        childDisplayDepth,
                        false
                    ));
                }
                Release(pendingElement.Element);
            }

            return new UiaSnapshot(
                $"uia_{Convert.ToHexString(Guid.NewGuid().ToByteArray()).ToLowerInvariant()[..20]}",
                builder.ToString(),
                elements,
                focused,
                selectedText,
                selected.ToArray(),
                documentText,
                truncated,
                ComputeFingerprint(elements.Values)
            );
        }
        catch (ComputerUseException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new ComputerUseException(
                "CU_INTERNAL_ERROR",
                "UI Automation snapshot failed.",
                retryable: true,
                requiresFreshState: true,
                innerException: error
            );
        }
    }

    public object ToProtocolObject()
    {
        return new
        {
            revision = Revision,
            tree = Tree,
            focusedElement = FocusedElement?.ToString(CultureInfo.InvariantCulture),
            selectedText = SelectedText,
            selectedElements = SelectedElements
                .Select(index => index.ToString(CultureInfo.InvariantCulture))
                .ToArray(),
            documentText = DocumentText,
            truncated = Truncated,
            elementIndexes = ElementIndexes.Order().ToArray(),
        };
    }

    public UiaElementSnapshot GetElement(int index)
    {
        if (!_elements.TryGetValue(index, out var element))
        {
            throw new ComputerUseException(
                "CU_UIA_STALE",
                "The UI Automation element does not belong to this observation.",
                retryable: true,
                requiresFreshState: true
            );
        }
        return element;
    }

    public bool FocusedElementIsPassword()
    {
        return FocusedElement is int index
            && _elements.TryGetValue(index, out var element)
            && element.IsPassword;
    }

    public void AssertCurrent(WindowInfo window)
    {
        var current = Capture(window, includeDocumentText: false);
        if (!string.Equals(Fingerprint, current.Fingerprint, StringComparison.Ordinal))
        {
            throw Stale("The UI Automation tree changed after observation.");
        }
    }

    public static IUIAutomationElement FindCurrentElement(
        WindowInfo window,
        UiaElementSnapshot expected
    )
    {
        try
        {
            var root = Automation.ElementFromHandle(window.Handle);
            if (root is null)
            {
                throw Stale("UI Automation could not resolve the target window.");
            }
            var pending = new Stack<(IUIAutomationElement Element, int Depth)>();
            pending.Push((root, 0));
            var visited = 0;
            while (pending.Count > 0 && visited < MaxNodes)
            {
                var current = pending.Pop();
                if (current.Depth > MaxDepth)
                {
                    Release(current.Element);
                    continue;
                }
                visited += 1;
                int[] runtimeId;
                try
                {
                    runtimeId = current.Element.GetRuntimeId();
                }
                catch
                {
                    Release(current.Element);
                    continue;
                }
                if (runtimeId.SequenceEqual(expected.RuntimeId))
                {
                    ValidateCurrentElement(window, current.Element, expected);
                    foreach (var queued in pending)
                    {
                        Release(queued.Element);
                    }
                    return current.Element;
                }
                var children = ReadChildren(current.Element, MaxNodes - visited);
                for (var index = children.Count - 1; index >= 0; index--)
                {
                    pending.Push((children[index], current.Depth + 1));
                }
                Release(current.Element);
            }
            ReleasePending(pending);
            throw Stale("The UI Automation element is no longer present.");
        }
        catch (ComputerUseException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new ComputerUseException(
                "CU_UIA_STALE",
                "The UI Automation element could not be revalidated.",
                retryable: true,
                requiresFreshState: true,
                innerException: error
            );
        }
    }

    public static bool TryPattern<T>(
        IUIAutomationElement element,
        int patternId,
        out T pattern
    ) where T : class
    {
        try
        {
            if (element.GetCurrentPattern(patternId) is T typed)
            {
                pattern = typed;
                return true;
            }
        }
        catch
        {
            // Pattern availability may change after the snapshot.
        }
        pattern = null!;
        return false;
    }

    public static void Release(object? value)
    {
        if (value is not null && Marshal.IsComObject(value))
        {
            try
            {
                Marshal.ReleaseComObject(value);
            }
            catch
            {
                // Releasing an RCW is best effort; never mask the action result.
            }
        }
    }

    private static void ValidateCurrentElement(
        WindowInfo window,
        IUIAutomationElement current,
        UiaElementSnapshot expected
    )
    {
        try
        {
            var controlType = NormalizeControlType(current.CurrentControlType);
            var name = Clean(current.CurrentName);
            var bounds = ToRect(current.CurrentBoundingRectangle);
            var patterns = SupportedPatterns(current);
            var password = current.CurrentIsPassword != 0;
            var value = password ? null : TryReadValue(current, patterns);
            var states = ReadStates(current, patterns);
            if (
                current.CurrentProcessId != window.Identity.Pid
                || !string.Equals(controlType, expected.ControlType, StringComparison.Ordinal)
                || !string.Equals(name, expected.Name, StringComparison.Ordinal)
                || !string.Equals(
                    Clean(current.CurrentAutomationId),
                    expected.AutomationId,
                    StringComparison.Ordinal
                )
                || !string.Equals(
                    Clean(current.CurrentClassName),
                    expected.ClassName,
                    StringComparison.Ordinal
                )
                || !string.Equals(
                    Clean(current.CurrentFrameworkId),
                    expected.FrameworkId,
                    StringComparison.Ordinal
                )
                || !bounds.NearlyEquals(expected.Bounds)
                || password != expected.IsPassword
                || !string.Equals(value, expected.Value, StringComparison.Ordinal)
                || !patterns.SequenceEqual(expected.Patterns, StringComparer.Ordinal)
                || !states.SequenceEqual(expected.States, StringComparer.Ordinal)
            )
            {
                throw Stale("The UI Automation element changed after observation.");
            }
            if (current.CurrentIsEnabled == 0 || current.CurrentIsOffscreen != 0)
            {
                throw Stale("The UI Automation element is disabled or offscreen.");
            }
        }
        catch (ComputerUseException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new ComputerUseException(
                "CU_UIA_STALE",
                "The UI Automation element is no longer available.",
                retryable: true,
                requiresFreshState: true,
                innerException: error
            );
        }
    }

    private static bool TryReadElement(
        IUIAutomationElement automationElement,
        int index,
        out UiaElementSnapshot element
    )
    {
        try
        {
            var runtimeId = automationElement.GetRuntimeId();
            var supported = SupportedPatterns(automationElement);
            var password = automationElement.CurrentIsPassword != 0;
            var value = password ? null : TryReadValue(automationElement, supported);
            var states = ReadStates(automationElement, supported);
            var secondaryActions = SecondaryActions(automationElement, supported);
            element = new UiaElementSnapshot(
                index,
                runtimeId,
                Clean(automationElement.CurrentName),
                Clean(automationElement.CurrentAutomationId),
                NormalizeControlType(automationElement.CurrentControlType),
                Clean(automationElement.CurrentClassName),
                Clean(automationElement.CurrentFrameworkId),
                ToRect(automationElement.CurrentBoundingRectangle),
                automationElement.CurrentIsEnabled != 0,
                automationElement.CurrentIsOffscreen != 0,
                automationElement.CurrentIsKeyboardFocusable != 0,
                automationElement.CurrentHasKeyboardFocus != 0,
                password,
                value,
                states,
                supported,
                secondaryActions
            );
            return true;
        }
        catch
        {
            element = null!;
            return false;
        }
    }

    private static string[] SupportedPatterns(IUIAutomationElement element)
    {
        var patterns = new List<string>(10);
        foreach (var pair in KnownPatterns)
        {
            if (!TryPattern<object>(element, pair.Id, out var pattern))
            {
                continue;
            }
            patterns.Add(pair.Name);
            Release(pattern);
        }
        return patterns.ToArray();
    }

    private static string? TryReadValue(IUIAutomationElement element, string[] supported)
    {
        if (
            supported.Contains("Value", StringComparer.Ordinal)
            && TryPattern<IUIAutomationValuePattern>(
                element,
                UIA_ValuePatternId,
                out var valuePattern
            )
        )
        {
            try
            {
                return Clean(valuePattern.CurrentValue);
            }
            finally
            {
                Release(valuePattern);
            }
        }
        if (
            supported.Contains("RangeValue", StringComparer.Ordinal)
            && TryPattern<IUIAutomationRangeValuePattern>(
                element,
                UIA_RangeValuePatternId,
                out var rangePattern
            )
        )
        {
            try
            {
                return rangePattern.CurrentValue.ToString(CultureInfo.InvariantCulture);
            }
            finally
            {
                Release(rangePattern);
            }
        }
        return null;
    }

    private static string[] SecondaryActions(IUIAutomationElement element, string[] patterns)
    {
        var actions = new List<string>(3);
        if (patterns.Contains("Toggle", StringComparer.Ordinal))
        {
            actions.Add("toggle");
        }
        if (patterns.Contains("SelectionItem", StringComparer.Ordinal))
        {
            actions.Add("select");
        }
        if (
            patterns.Contains("ExpandCollapse", StringComparer.Ordinal)
            && TryPattern<IUIAutomationExpandCollapsePattern>(
                element,
                UIA_ExpandCollapsePatternId,
                out var expandCollapse
            )
        )
        {
            try
            {
                if (
                    expandCollapse.CurrentExpandCollapseState
                    == ExpandCollapseState.ExpandCollapseState_Collapsed
                )
                {
                    actions.Add("expand");
                }
                else if (
                    expandCollapse.CurrentExpandCollapseState
                    == ExpandCollapseState.ExpandCollapseState_Expanded
                )
                {
                    actions.Add("collapse");
                }
            }
            finally
            {
                Release(expandCollapse);
            }
        }
        return actions.ToArray();
    }

    private static string[] ReadStates(
        IUIAutomationElement element,
        string[] supported
    )
    {
        var states = new List<string>(4);
        if (
            supported.Contains("SelectionItem", StringComparer.Ordinal)
            && TryPattern<IUIAutomationSelectionItemPattern>(
                element,
                UIA_SelectionItemPatternId,
                out var pattern
            )
        )
        {
            try
            {
                if (pattern.CurrentIsSelected != 0)
                {
                    states.Add("selected");
                }
            }
            catch
            {
                // State is optional; pattern presence remains in the descriptor.
            }
            finally
            {
                Release(pattern);
            }
        }
        if (
            supported.Contains("Toggle", StringComparer.Ordinal)
            && TryPattern<IUIAutomationTogglePattern>(
                element,
                UIA_TogglePatternId,
                out var toggle
            )
        )
        {
            try
            {
                states.Add(toggle.CurrentToggleState switch
                {
                    ToggleState.ToggleState_On => "checked",
                    ToggleState.ToggleState_Off => "unchecked",
                    _ => "indeterminate",
                });
            }
            catch
            {
                // State is optional; pattern presence remains in the descriptor.
            }
            finally
            {
                Release(toggle);
            }
        }
        if (
            supported.Contains("ExpandCollapse", StringComparer.Ordinal)
            && TryPattern<IUIAutomationExpandCollapsePattern>(
                element,
                UIA_ExpandCollapsePatternId,
                out var expandCollapse
            )
        )
        {
            try
            {
                states.Add(expandCollapse.CurrentExpandCollapseState switch
                {
                    ExpandCollapseState.ExpandCollapseState_Collapsed => "collapsed",
                    ExpandCollapseState.ExpandCollapseState_Expanded => "expanded",
                    ExpandCollapseState.ExpandCollapseState_PartiallyExpanded
                        => "partially-expanded",
                    _ => "leaf",
                });
            }
            catch
            {
                // State is optional; pattern presence remains in the descriptor.
            }
            finally
            {
                Release(expandCollapse);
            }
        }
        return states.ToArray();
    }

    private static string ComputeFingerprint(IEnumerable<UiaElementSnapshot> elements)
    {
        var builder = new StringBuilder();
        foreach (var element in elements.OrderBy(element => element.Index))
        {
            builder
                .Append(element.Index).Append('|')
                .Append(RuntimeKey(element.RuntimeId)).Append('|')
                .Append(element.ControlType).Append('|')
                .Append(element.Name).Append('|')
                .Append(element.AutomationId).Append('|')
                .Append(element.ClassName).Append('|')
                .Append(element.FrameworkId).Append('|')
                .Append(element.Bounds.X).Append(',')
                .Append(element.Bounds.Y).Append(',')
                .Append(element.Bounds.Width).Append(',')
                .Append(element.Bounds.Height).Append('|')
                .Append(element.IsEnabled).Append('|')
                .Append(element.IsOffscreen).Append('|')
                .Append(element.IsPassword).Append('|')
                .Append(element.Value).Append('|')
                .AppendJoin(',', element.States).Append('|')
                .AppendJoin(',', element.Patterns).Append('\n');
        }
        return Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString()))
        ).ToLowerInvariant();
    }

    private static string? TryReadSelectedText(IUIAutomationElement element)
    {
        if (
            !TryPattern<IUIAutomationTextPattern>(
                element,
                UIA_TextPatternId,
                out var pattern
            )
        )
        {
            return null;
        }
        try
        {
            var ranges = pattern.GetSelection();
            if (ranges is null)
            {
                return null;
            }
            try
            {
                var selected = new List<string>(Math.Min(ranges.Length, 16));
                for (var index = 0; index < ranges.Length && selected.Count < 16; index++)
                {
                    var range = ranges.GetElement(index);
                    try
                    {
                        selected.Add(range.GetText(MaxPropertyChars));
                    }
                    finally
                    {
                        Release(range);
                    }
                }
                var text = string.Join("\n", selected);
                return string.IsNullOrEmpty(text) ? null : Clean(text);
            }
            finally
            {
                Release(ranges);
            }
        }
        catch
        {
            return null;
        }
        finally
        {
            Release(pattern);
        }
    }

    private static string? TryReadDocumentText(IUIAutomationElement element)
    {
        if (
            !TryPattern<IUIAutomationTextPattern>(
                element,
                UIA_TextPatternId,
                out var pattern
            )
        )
        {
            return null;
        }
        try
        {
            var range = pattern.DocumentRange;
            try
            {
                var text = range.GetText(MaxDocumentTextChars);
                return string.IsNullOrEmpty(text)
                    ? null
                    : Clean(text, MaxDocumentTextChars, preserveLineBreaks: true);
            }
            finally
            {
                Release(range);
            }
        }
        catch
        {
            return null;
        }
        finally
        {
            Release(pattern);
        }
    }

    private static List<IUIAutomationElement> ReadChildren(
        IUIAutomationElement parent,
        int limit
    )
    {
        var children = new List<IUIAutomationElement>();
        if (limit <= 0)
        {
            return children;
        }
        try
        {
            var walker = Automation.ControlViewWalker;
            var child = walker.GetFirstChildElement(parent);
            while (child is not null && children.Count < limit)
            {
                children.Add(child);
                child = walker.GetNextSiblingElement(child);
            }
        }
        catch
        {
            // A single faulty provider subtree must not discard the whole snapshot.
        }
        return children;
    }

    private static bool ShouldInclude(UiaElementSnapshot element)
    {
        if (
            element.Name.Length > 0
            || element.AutomationId.Length > 0
            || element.Value is not null
            || element.Patterns.Length > 0
            || element.HasKeyboardFocus
        )
        {
            return true;
        }
        return element.ControlType is
            "window" or
            "button" or
            "edit" or
            "document" or
            "menu" or
            "menuitem" or
            "list" or
            "listitem" or
            "tree" or
            "treeitem" or
            "tab" or
            "tabitem" or
            "checkbox" or
            "radiobutton" or
            "combobox";
    }

    private static string FormatTreeLine(UiaElementSnapshot element, int depth)
    {
        var builder = new StringBuilder();
        builder.Append(' ', Math.Min(depth, MaxDepth) * 2);
        builder.Append('[').Append(element.Index).Append("] ").Append(element.ControlType);
        if (element.Name.Length > 0)
        {
            builder.Append(" \"").Append(Escape(element.Name)).Append('"');
        }
        if (element.IsPassword)
        {
            builder.Append(" password");
        }
        else if (element.Value is not null)
        {
            builder.Append(" value=\"").Append(Escape(element.Value)).Append('"');
        }
        if (element.IsEnabled)
        {
            builder.Append(" enabled");
        }
        if (element.HasKeyboardFocus)
        {
            builder.Append(" focused");
        }
        if (element.IsOffscreen)
        {
            builder.Append(" offscreen");
        }
        if (element.Bounds.IsUsable)
        {
            builder
                .Append(" bounds=(")
                .Append(Math.Round(element.Bounds.X))
                .Append(',')
                .Append(Math.Round(element.Bounds.Y))
                .Append(',')
                .Append(Math.Round(element.Bounds.Width))
                .Append(',')
                .Append(Math.Round(element.Bounds.Height))
                .Append(')');
        }
        if (element.Patterns.Length > 0)
        {
            builder.Append(" patterns=").Append(string.Join(',', element.Patterns));
        }
        if (element.States.Length > 0)
        {
            builder.Append(' ').Append(string.Join(' ', element.States));
        }
        if (element.SecondaryActions.Length > 0)
        {
            builder.Append(" secondary=").Append(string.Join(',', element.SecondaryActions));
        }
        builder.AppendLine();
        return builder.ToString();
    }

    private static string NormalizeControlType(int controlType)
    {
        return controlType switch
        {
            UIA_ButtonControlTypeId => "button",
            UIA_CalendarControlTypeId => "calendar",
            UIA_CheckBoxControlTypeId => "checkbox",
            UIA_ComboBoxControlTypeId => "combobox",
            UIA_EditControlTypeId => "edit",
            UIA_HyperlinkControlTypeId => "hyperlink",
            UIA_ImageControlTypeId => "image",
            UIA_ListItemControlTypeId => "listitem",
            UIA_ListControlTypeId => "list",
            UIA_MenuControlTypeId => "menu",
            UIA_MenuBarControlTypeId => "menubar",
            UIA_MenuItemControlTypeId => "menuitem",
            UIA_ProgressBarControlTypeId => "progressbar",
            UIA_RadioButtonControlTypeId => "radiobutton",
            UIA_ScrollBarControlTypeId => "scrollbar",
            UIA_SliderControlTypeId => "slider",
            UIA_SpinnerControlTypeId => "spinner",
            UIA_StatusBarControlTypeId => "statusbar",
            UIA_TabControlTypeId => "tab",
            UIA_TabItemControlTypeId => "tabitem",
            UIA_TextControlTypeId => "text",
            UIA_ToolBarControlTypeId => "toolbar",
            UIA_ToolTipControlTypeId => "tooltip",
            UIA_TreeControlTypeId => "tree",
            UIA_TreeItemControlTypeId => "treeitem",
            UIA_GroupControlTypeId => "group",
            UIA_DataGridControlTypeId => "datagrid",
            UIA_DataItemControlTypeId => "dataitem",
            UIA_DocumentControlTypeId => "document",
            UIA_SplitButtonControlTypeId => "splitbutton",
            UIA_WindowControlTypeId => "window",
            UIA_PaneControlTypeId => "pane",
            UIA_HeaderControlTypeId => "header",
            UIA_HeaderItemControlTypeId => "headeritem",
            UIA_TableControlTypeId => "table",
            UIA_TitleBarControlTypeId => "titlebar",
            UIA_SeparatorControlTypeId => "separator",
            _ => "custom",
        };
    }

    private static UiaRect ToRect(tagRECT rect)
    {
        return new UiaRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    }

    private static string RuntimeKey(int[] runtimeId)
    {
        return string.Join(".", runtimeId);
    }

    private static bool HasPattern(UiaElementSnapshot element, string pattern)
    {
        return element.Patterns.Contains(pattern, StringComparer.Ordinal);
    }

    private static string Clean(
        string? value,
        int maxLength = MaxPropertyChars,
        bool preserveLineBreaks = false
    )
    {
        if (string.IsNullOrEmpty(value))
        {
            return "";
        }
        var builder = new StringBuilder(Math.Min(value.Length, maxLength));
        foreach (var character in value)
        {
            if (builder.Length >= maxLength)
            {
                break;
            }
            if (character is '\r' or '\n')
            {
                builder.Append(preserveLineBreaks ? character : ' ');
            }
            else if (!char.IsControl(character) || character == '\t')
            {
                builder.Append(character);
            }
        }
        return builder.ToString();
    }

    private static string Escape(string value)
    {
        return value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("\"", "\\\"", StringComparison.Ordinal);
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

    private static (IUIAutomation? Automation, string? Diagnostic) CreateRuntime()
    {
        try
        {
            var automation = (IUIAutomation)new CUIAutomation8Class();
            if (automation is IUIAutomation2 automation2)
            {
                automation2.ConnectionTimeout = 5_000;
                automation2.TransactionTimeout = 5_000;
            }
            var root = automation.GetRootElement();
            if (root is null)
            {
                Release(automation);
                return (null, "CUIAutomation8.GetRootElement returned null.");
            }
            Release(root);
            return (automation, null);
        }
        catch (Exception error)
        {
            var parts = new List<string>();
            for (var current = error; current is not null; current = current.InnerException)
            {
                parts.Add($"{current.GetType().Name}: {current.Message}");
            }
            return (null, string.Join(" -> ", parts));
        }
    }

    private static void ReleasePending(Stack<PendingElement> pending)
    {
        foreach (var item in pending)
        {
            Release(item.Element);
        }
        pending.Clear();
    }

    private static void ReleasePending(
        Stack<(IUIAutomationElement Element, int Depth)> pending
    )
    {
        foreach (var item in pending)
        {
            Release(item.Element);
        }
        pending.Clear();
    }

    private static readonly (int Id, string Name)[] KnownPatterns =
    [
        (UIA_InvokePatternId, "Invoke"),
        (UIA_ValuePatternId, "Value"),
        (UIA_RangeValuePatternId, "RangeValue"),
        (UIA_SelectionPatternId, "Selection"),
        (UIA_SelectionItemPatternId, "SelectionItem"),
        (UIA_ExpandCollapsePatternId, "ExpandCollapse"),
        (UIA_TogglePatternId, "Toggle"),
        (UIA_ScrollPatternId, "Scroll"),
        (UIA_ScrollItemPatternId, "ScrollItem"),
        (UIA_TextPatternId, "Text"),
    ];

    private sealed record PendingElement(
        IUIAutomationElement Element,
        int TraversalDepth,
        int DisplayDepth,
        bool IsRoot
    );
}
