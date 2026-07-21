using System.Drawing;
using Microsoft.Win32;

namespace ComputerUse.Helper.Overlay;

internal sealed record OverlayPalette(Color Border, Color Banner, Color Text, string Theme)
{
    private const string PersonalizeKey = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

    private static readonly OverlayPalette Light = new(
        Color.FromArgb(0x0A, 0x65, 0xFF),
        Color.FromArgb(0x0A, 0x65, 0xFF),
        Color.White,
        "light"
    );

    private static readonly OverlayPalette Dark = new(
        Color.FromArgb(0x5A, 0xA2, 0xFF),
        Color.FromArgb(0x16, 0x4F, 0x9E),
        Color.White,
        "dark"
    );

    public static OverlayPalette Current()
    {
        if (SystemInformation.HighContrast)
        {
            return new OverlayPalette(
                SystemColors.Highlight,
                SystemColors.Highlight,
                SystemColors.HighlightText,
                "high-contrast"
            );
        }

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(PersonalizeKey, writable: false);
            var value = key?.GetValue("SystemUsesLightTheme");
            if (value is int number && number == 0)
            {
                return Dark;
            }
        }
        catch
        {
            // Theme lookup is cosmetic. The light palette remains safe and legible.
        }
        return Light;
    }
}
