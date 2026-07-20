using System.Security.Cryptography;
using System.Text;

namespace ComputerUse.Helper.Apps;

internal static class AppIdentity
{
    public static string ForWin32(string processName, string executablePath)
    {
        var normalizedProcess = NormalizeProcessName(processName);
        var identity = FileIdentity(executablePath) ?? normalizedProcess;
        var hash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(identity.ToLowerInvariant()))
        ).ToLowerInvariant();
        return $"win32:{normalizedProcess}:{hash[..16]}";
    }

    public static string ForAumid(string aumid)
    {
        return $"aumid:{aumid.Trim().ToLowerInvariant()}";
    }

    public static string? FileIdentity(string executablePath)
    {
        try
        {
            if (
                string.IsNullOrWhiteSpace(executablePath)
                || !Path.IsPathRooted(executablePath)
            )
            {
                return null;
            }
            var path = Path.GetFullPath(executablePath);
            var file = new FileInfo(path);
            if (!file.Exists || !file.Extension.Equals(".exe", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
            return string.Join(
                "|",
                path.ToLowerInvariant(),
                file.Length,
                file.LastWriteTimeUtc.Ticks
            );
        }
        catch
        {
            return null;
        }
    }

    public static string NormalizeProcessName(string value)
    {
        var normalized = Path.GetFileName(value ?? "").Trim().ToLowerInvariant();
        return normalized.EndsWith(".exe", StringComparison.Ordinal)
            ? normalized
            : $"{normalized}.exe";
    }
}
