using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.Windows;

namespace ComputerUse.Helper.Policy;

internal static class TargetPolicy
{
    private static readonly HashSet<string> BlockedProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "1password.exe",
        "anybox.exe",
        "anybox-agent.exe",
        "anybox-desktop-agent.exe",
        "bash.exe",
        "bitwarden.exe",
        "chatgpt.exe",
        "cmd.exe",
        "codex.exe",
        "conhost.exe",
        "consent.exe",
        "computer-use-helper.exe",
        "credentialui.exe",
        "dashlane.exe",
        "keepass.exe",
        "keepassxc.exe",
        "lastpass.exe",
        "lockapp.exe",
        "openconsole.exe",
        "powershell.exe",
        "pwsh.exe",
        "securityhealthsystray.exe",
        "windowsterminal.exe",
        "wsl.exe",
        "wslhost.exe",
        "wt.exe",
    };

    private static readonly string[] BlockedTitleFragments =
    [
        "captcha",
        "credential",
        "user account control",
        "windows security",
        "security warning",
        "deceptive site ahead",
        "privacy error",
        "your connection is not private",
    ];

    private static readonly string[] BlockedIdentityFragments =
    [
        "microsoft.windows.sechealthui",
        "microsoft.windows.terminal",
        "microsoft.accountspayments",
        "microsoft.windows.auth",
        "credential",
        "passwordmanager",
    ];

    public static void AssertAllowed(WindowInfo window)
    {
        var helperIntegrity = IntegrityInspector.Rank(IntegrityInspector.CurrentLevel);
        var targetIntegrity = IntegrityInspector.Rank(window.Identity.IntegrityLevel);
        if (
            helperIntegrity < 0
            || targetIntegrity < 0
            || targetIntegrity > helperIntegrity
        )
        {
            throw new ComputerUseException(
                "CU_HIGHER_INTEGRITY_TARGET",
                "Computer Use cannot verify that its integrity level is sufficient for this target."
            );
        }
        var blockReason = BlockReason(
            window.ProcessName,
            window.Title,
            window.Identity.ExecutableIdentity
        );
        if (blockReason is not null)
        {
            throw new ComputerUseException(
                "CU_APP_BLOCKED",
                blockReason
            );
        }
    }

    public static string? BlockReason(
        string processName,
        string displayOrTitle,
        string stableIdentity
    )
    {
        var normalizedProcess = processName.Trim().ToLowerInvariant();
        if (BlockedProcesses.Contains(normalizedProcess))
        {
            return $"Blocked target process: {normalizedProcess}";
        }
        var title = displayOrTitle.Trim().ToLowerInvariant();
        if (
            title is "anybox" or "anybox agent desktop" or "windows security"
            || BlockedTitleFragments.Any(title.Contains)
        )
        {
            return "Blocked target by Computer Use security policy.";
        }
        var identity = stableIdentity.Trim().ToLowerInvariant();
        if (BlockedIdentityFragments.Any(identity.Contains))
        {
            return "Blocked application identity by Computer Use security policy.";
        }
        return null;
    }
}
