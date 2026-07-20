using System.Diagnostics;
using System.Security.Cryptography;
using System.Xml;
using System.Xml.Linq;
using ComputerUse.Helper.Policy;
using ComputerUse.Helper.Protocol;
using ComputerUse.Helper.Windows;
using Microsoft.Win32;
using Windows.Management.Deployment;

namespace ComputerUse.Helper.Apps;

internal sealed record AppCatalogEntry(
    string CatalogRef,
    string AppId,
    string DisplayName,
    string Kind,
    string ProcessName,
    string? ExecutablePath,
    string? ExecutableFileIdentity,
    string? Aumid,
    bool CanLaunch,
    bool Blocked,
    string? BlockReason,
    WindowInfo[] Windows
)
{
    public object ToProtocolObject()
    {
        return new
        {
            catalogRef = CatalogRef,
            appId = AppId,
            displayName = DisplayName,
            kind = Kind,
            processName = ProcessName,
            isRunning = Windows.Length > 0,
            canLaunch = CanLaunch,
            blocked = Blocked,
            blockReason = BlockReason,
            windows = Windows.Select(window => window.ToProtocolObject()).ToArray(),
        };
    }
}

internal static class AppCatalog
{
    private const int MaxApps = 512;
    private static readonly TimeSpan CatalogTtl = TimeSpan.FromMinutes(2);
    private static readonly Dictionary<string, CatalogRecord> ByRef = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, CatalogRecord> ByAppId = new(StringComparer.Ordinal);

    public static object ListApps()
    {
        var entries = Build();
        ByRef.Clear();
        ByAppId.Clear();
        var expiresAt = DateTimeOffset.UtcNow + CatalogTtl;
        foreach (var entry in entries)
        {
            var record = new CatalogRecord(entry, expiresAt);
            ByRef[entry.CatalogRef] = record;
            ByAppId[entry.AppId] = record;
        }
        return new
        {
            apps = entries.Select(entry => entry.ToProtocolObject()).ToArray(),
        };
    }

    public static object Launch(string catalogRef, string appId)
    {
        if (
            string.IsNullOrWhiteSpace(catalogRef)
            || string.IsNullOrWhiteSpace(appId)
            || !ByRef.TryGetValue(catalogRef, out var record)
            || !string.Equals(record.Entry.AppId, appId, StringComparison.Ordinal)
            || !ByAppId.TryGetValue(appId, out var appRecord)
            || !ReferenceEquals(record, appRecord)
            || DateTimeOffset.UtcNow > record.ExpiresAt
        )
        {
            throw new ComputerUseException(
                "CU_APP_APPROVAL_REQUIRED",
                "The application catalog entry expired. List applications again before launching.",
                retryable: true
            );
        }
        var entry = record.Entry;
        if (entry.Blocked)
        {
            throw new ComputerUseException(
                "CU_APP_BLOCKED",
                entry.BlockReason ?? "The selected application is blocked."
            );
        }
        if (!entry.CanLaunch)
        {
            throw new ComputerUseException(
                "CU_INVALID_ARGUMENT",
                "The selected catalog entry cannot be launched."
            );
        }
        DesktopGuard.AssertInteractive();
        if (entry.Kind == "win32")
        {
            LaunchWin32(entry);
        }
        else if (entry.Kind == "packaged" && entry.Aumid is { Length: > 0 } aumid)
        {
            PackagedAppLauncher.Launch(aumid);
        }
        else
        {
            throw new ComputerUseException(
                "CU_INVALID_ARGUMENT",
                "The selected application has no supported launch target."
            );
        }
        return new
        {
            launched = true,
            appId = entry.AppId,
        };
    }

    private static AppCatalogEntry[] Build()
    {
        var apps = new Dictionary<string, MutableApp>(StringComparer.Ordinal);
        var windows = WindowInfo.EnumerateCandidates();
        foreach (var window in windows)
        {
            var appId = window.AppId;
            if (!apps.TryGetValue(appId, out var app))
            {
                var path = AppIdentity.FileIdentity(window.Identity.ExecutableIdentity) is not null
                    ? window.Identity.ExecutableIdentity
                    : null;
                app = new MutableApp(
                    appId,
                    DisplayName(window.ProcessName, path),
                    "win32",
                    window.ProcessName,
                    path,
                    null
                );
                apps[appId] = app;
            }
            app.Windows.Add(window);
        }

        foreach (var registered in EnumerateRegisteredWin32Apps())
        {
            if (!apps.TryGetValue(registered.AppId, out var existing))
            {
                apps[registered.AppId] = registered;
            }
            else if (existing.ExecutablePath is null)
            {
                existing.ExecutablePath = registered.ExecutablePath;
            }
        }

        foreach (var packaged in EnumeratePackagedApps())
        {
            if (!apps.ContainsKey(packaged.AppId))
            {
                apps[packaged.AppId] = packaged;
            }
        }

        return apps.Values
            .OrderByDescending(app => app.Windows.Count > 0)
            .ThenBy(app => app.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Take(MaxApps)
            .Select(app =>
            {
                var identity = app.Aumid ?? app.ExecutablePath ?? app.ProcessName;
                var blockReason = TargetPolicy.BlockReason(
                    app.ProcessName,
                    app.DisplayName,
                    identity
                );
                var fileIdentity = app.ExecutablePath is null
                    ? null
                    : AppIdentity.FileIdentity(app.ExecutablePath);
                return new AppCatalogEntry(
                    MakeRef(),
                    app.AppId,
                    Clean(app.DisplayName),
                    app.Kind,
                    app.ProcessName,
                    app.ExecutablePath,
                    fileIdentity,
                    app.Aumid,
                    app.Aumid is not null || fileIdentity is not null,
                    blockReason is not null,
                    blockReason,
                    app.Windows.ToArray()
                );
            })
            .ToArray();
    }

    private static IEnumerable<MutableApp> EnumerateRegisteredWin32Apps()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        {
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                RegistryKey? root = null;
                RegistryKey? appPaths = null;
                try
                {
                    root = RegistryKey.OpenBaseKey(hive, view);
                    appPaths = root.OpenSubKey(
                        @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
                        writable: false
                    );
                    if (appPaths is null)
                    {
                        continue;
                    }
                    foreach (var subkeyName in appPaths.GetSubKeyNames().Take(2_000))
                    {
                        using var key = appPaths.OpenSubKey(subkeyName, writable: false);
                        var path = NormalizeRegisteredPath(key?.GetValue(null) as string);
                        if (path is null || !seen.Add(path))
                        {
                            continue;
                        }
                        var processName = AppIdentity.NormalizeProcessName(path);
                        yield return new MutableApp(
                            AppIdentity.ForWin32(processName, path),
                            DisplayName(processName, path),
                            "win32",
                            processName,
                            path,
                            null
                        );
                    }
                }
                finally
                {
                    appPaths?.Dispose();
                    root?.Dispose();
                }
            }
        }
    }

    private static IEnumerable<MutableApp> EnumeratePackagedApps()
    {
        IEnumerable<global::Windows.ApplicationModel.Package> packages;
        try
        {
            packages = new PackageManager().FindPackagesForUser("");
        }
        catch
        {
            yield break;
        }

        var count = 0;
        foreach (var package in packages)
        {
            if (count >= 1_000)
            {
                yield break;
            }
            count += 1;
            string manifestPath;
            string familyName;
            string packageDisplayName;
            try
            {
                if (package.IsFramework || package.IsResourcePackage)
                {
                    continue;
                }
                manifestPath = Path.Combine(
                    package.InstalledLocation.Path,
                    "AppxManifest.xml"
                );
                familyName = package.Id.FamilyName;
                packageDisplayName = package.DisplayName;
            }
            catch
            {
                continue;
            }
            XDocument document;
            try
            {
                var settings = new XmlReaderSettings
                {
                    DtdProcessing = DtdProcessing.Prohibit,
                    XmlResolver = null,
                };
                using var reader = XmlReader.Create(manifestPath, settings);
                document = XDocument.Load(reader, LoadOptions.None);
            }
            catch
            {
                continue;
            }
            foreach (
                var application in document
                    .Descendants()
                    .Where(element => element.Name.LocalName == "Application")
                    .Take(64)
            )
            {
                var id = application.Attribute("Id")?.Value.Trim();
                if (string.IsNullOrWhiteSpace(id))
                {
                    continue;
                }
                var aumid = $"{familyName}!{id}";
                var executable = application.Attribute("Executable")?.Value ?? "";
                var processName = string.IsNullOrWhiteSpace(executable)
                    ? ""
                    : AppIdentity.NormalizeProcessName(executable);
                var displayName = application.Attribute("DisplayName")?.Value;
                if (
                    string.IsNullOrWhiteSpace(displayName)
                    || displayName.StartsWith("ms-resource:", StringComparison.OrdinalIgnoreCase)
                )
                {
                    displayName = packageDisplayName;
                }
                if (
                    string.IsNullOrWhiteSpace(displayName)
                    || displayName.StartsWith("ms-resource:", StringComparison.OrdinalIgnoreCase)
                )
                {
                    displayName = id;
                }
                yield return new MutableApp(
                    AppIdentity.ForAumid(aumid),
                    Clean(displayName),
                    "packaged",
                    processName,
                    null,
                    aumid
                );
            }
        }
    }

    private static void LaunchWin32(AppCatalogEntry entry)
    {
        var path = entry.ExecutablePath;
        if (
            path is null
            || entry.ExecutableFileIdentity is null
            || !string.Equals(
                AppIdentity.FileIdentity(path),
                entry.ExecutableFileIdentity,
                StringComparison.Ordinal
            )
            || !string.Equals(
                AppIdentity.ForWin32(entry.ProcessName, path),
                entry.AppId,
                StringComparison.Ordinal
            )
        )
        {
            throw new ComputerUseException(
                "CU_APP_BLOCKED",
                "The registered executable changed after application discovery."
            );
        }
        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            Arguments = "",
            WorkingDirectory = Path.GetDirectoryName(path) ?? Environment.CurrentDirectory,
            UseShellExecute = true,
        });
    }

    private static string? NormalizeRegisteredPath(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }
        var value = Environment.ExpandEnvironmentVariables(raw.Trim());
        if (value.StartsWith('"') && value.EndsWith('"') && value.Length > 2)
        {
            value = value[1..^1];
        }
        try
        {
            var path = Path.GetFullPath(value);
            return AppIdentity.FileIdentity(path) is null ? null : path;
        }
        catch
        {
            return null;
        }
    }

    private static string DisplayName(string processName, string? path)
    {
        if (path is not null)
        {
            try
            {
                var version = FileVersionInfo.GetVersionInfo(path);
                var name = version.FileDescription ?? version.ProductName;
                if (!string.IsNullOrWhiteSpace(name))
                {
                    return Clean(name);
                }
            }
            catch
            {
                // Fall back to the executable name without exposing its path.
            }
        }
        return Path.GetFileNameWithoutExtension(processName);
    }

    private static string Clean(string value)
    {
        var cleaned = new string(
            (value ?? "")
                .Where(character => !char.IsControl(character))
                .Take(256)
                .ToArray()
        ).Trim();
        return cleaned.Length > 0 ? cleaned : "Windows application";
    }

    private static string MakeRef()
    {
        return $"catalog_{Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant()}";
    }

    private sealed record CatalogRecord(AppCatalogEntry Entry, DateTimeOffset ExpiresAt);

    private sealed class MutableApp
    {
        public MutableApp(
            string appId,
            string displayName,
            string kind,
            string processName,
            string? executablePath,
            string? aumid
        )
        {
            AppId = appId;
            DisplayName = displayName;
            Kind = kind;
            ProcessName = processName;
            ExecutablePath = executablePath;
            Aumid = aumid;
        }

        public string AppId { get; }

        public string DisplayName { get; }

        public string Kind { get; }

        public string ProcessName { get; }

        public string? ExecutablePath { get; set; }

        public string? Aumid { get; }

        public List<WindowInfo> Windows { get; } = [];
    }
}
