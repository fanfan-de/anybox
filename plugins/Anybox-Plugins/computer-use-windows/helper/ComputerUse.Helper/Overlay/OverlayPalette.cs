using System.Drawing;
using Microsoft.Win32;

namespace ComputerUse.Helper.Overlay;

internal sealed record OverlayPalette(
    Color Border,
    Color BorderHighlight,
    Color BorderMuted,
    Color Banner,
    Color BannerOutline,
    Color Text,
    Color SecondaryText,
    Color Separator,
    string Theme
)
{
    private const string PersonalizeKey = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

    private static readonly OverlayPalette Light = Create(
        Color.FromArgb(0x33, 0x9C, 0xFF),
        dark: false,
        theme: "light"
    );

    private static readonly OverlayPalette Dark = Create(
        Color.FromArgb(0x4A, 0xAA, 0xFF),
        dark: true,
        theme: "dark"
    );

    public static OverlayPalette Current()
    {
        if (SystemInformation.HighContrast)
        {
            return new OverlayPalette(
                SystemColors.Highlight,
                SystemColors.HighlightText,
                SystemColors.Highlight,
                SystemColors.Highlight,
                SystemColors.HighlightText,
                SystemColors.HighlightText,
                SystemColors.HighlightText,
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

    internal static Color Mix(Color from, Color to, double amount)
    {
        var clamped = Math.Clamp(amount, 0d, 1d);
        return Color.FromArgb(
            MixChannel(from.R, to.R, clamped),
            MixChannel(from.G, to.G, clamped),
            MixChannel(from.B, to.B, clamped)
        );
    }

    private static OverlayPalette Create(Color accent, bool dark, string theme)
    {
        var banner = Mix(accent, Color.Black, dark ? 0.24d : 0.08d);
        return new OverlayPalette(
            Border: accent,
            BorderHighlight: Mix(accent, Color.White, dark ? 0.48d : 0.56d),
            BorderMuted: Mix(accent, dark ? Color.Black : Color.White, dark ? 0.38d : 0.24d),
            Banner: banner,
            BannerOutline: Mix(accent, Color.White, dark ? 0.32d : 0.46d),
            Text: Color.White,
            SecondaryText: Mix(banner, Color.White, 0.78d),
            Separator: Mix(banner, Color.White, 0.40d),
            Theme: theme
        );
    }

    private static int MixChannel(byte from, byte to, double amount)
    {
        return (int)Math.Round(from + (to - from) * amount);
    }
}
