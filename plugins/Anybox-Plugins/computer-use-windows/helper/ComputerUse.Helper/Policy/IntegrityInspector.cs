using System.Runtime.InteropServices;
using ComputerUse.Helper.Windows;
using static ComputerUse.Helper.Windows.NativeMethods;

namespace ComputerUse.Helper.Policy;

internal static class IntegrityInspector
{
    private const int SecurityMandatoryLowRid = 0x1000;
    private const int SecurityMandatoryMediumRid = 0x2000;
    private const int SecurityMandatoryHighRid = 0x3000;
    private const int SecurityMandatorySystemRid = 0x4000;
    private static readonly Lazy<string> Current = new(() => ReadFromProcess(GetCurrentProcess()));

    public static string CurrentLevel => Current.Value;

    public static string ForProcess(int processId)
    {
        var process = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION,
            inheritHandle: false,
            checked((uint)processId)
        );
        if (process == IntPtr.Zero)
        {
            return "unknown";
        }
        try
        {
            return ReadFromProcess(process);
        }
        finally
        {
            CloseHandle(process);
        }
    }

    public static int Rank(string level)
    {
        return level switch
        {
            "untrusted" => 0,
            "low" => 1,
            "medium" => 2,
            "high" => 3,
            "system" => 4,
            _ => -1,
        };
    }

    private static string ReadFromProcess(IntPtr process)
    {
        if (!OpenProcessToken(process, TOKEN_QUERY, out var token))
        {
            return "unknown";
        }
        try
        {
            GetTokenInformation(
                token,
                TOKEN_INTEGRITY_LEVEL,
                IntPtr.Zero,
                0,
                out var length
            );
            if (length <= 0)
            {
                return "unknown";
            }
            var buffer = Marshal.AllocHGlobal(length);
            try
            {
                if (
                    !GetTokenInformation(
                        token,
                        TOKEN_INTEGRITY_LEVEL,
                        buffer,
                        length,
                        out _
                    )
                )
                {
                    return "unknown";
                }
                var label = Marshal.PtrToStructure<TOKEN_MANDATORY_LABEL>(buffer);
                if (label.Label.Sid == IntPtr.Zero)
                {
                    return "unknown";
                }
                var countPointer = GetSidSubAuthorityCount(label.Label.Sid);
                if (countPointer == IntPtr.Zero)
                {
                    return "unknown";
                }
                var count = Marshal.ReadByte(countPointer);
                if (count == 0)
                {
                    return "unknown";
                }
                var ridPointer = GetSidSubAuthority(label.Label.Sid, (uint)(count - 1));
                if (ridPointer == IntPtr.Zero)
                {
                    return "unknown";
                }
                var rid = Marshal.ReadInt32(ridPointer);
                return rid switch
                {
                    < SecurityMandatoryLowRid => "untrusted",
                    < SecurityMandatoryMediumRid => "low",
                    < SecurityMandatoryHighRid => "medium",
                    < SecurityMandatorySystemRid => "high",
                    _ => "system",
                };
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            CloseHandle(token);
        }
    }
}
