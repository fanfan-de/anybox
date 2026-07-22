using System.Runtime.InteropServices;

namespace ComputerUse.Helper.Apps;

internal static class WindowAppIdentity
{
    private const ushort VtBstr = 8;
    private const ushort VtLpwstr = 31;
    private static readonly PropertyKey AppUserModelId = new(
        new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
        5
    );

    public static string? TryGetAumid(IntPtr window)
    {
        IPropertyStore? store = null;
        var value = default(PropVariant);
        try
        {
            var interfaceId = typeof(IPropertyStore).GUID;
            var result = SHGetPropertyStoreForWindow(window, ref interfaceId, out store);
            if (result < 0 || store is null)
            {
                return null;
            }
            var key = AppUserModelId;
            result = store.GetValue(ref key, out value);
            if (result < 0 || value.PointerValue == IntPtr.Zero)
            {
                return null;
            }
            var raw = value.VariantType switch
            {
                VtBstr or VtLpwstr => Marshal.PtrToStringUni(value.PointerValue),
                _ => null,
            };
            return string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();
        }
        catch
        {
            return null;
        }
        finally
        {
            if (value.VariantType != 0)
            {
                PropVariantClear(ref value);
            }
            if (store is not null && Marshal.IsComObject(store))
            {
                Marshal.ReleaseComObject(store);
            }
        }
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private readonly struct PropertyKey
    {
        public PropertyKey(Guid formatId, uint propertyId)
        {
            FormatId = formatId;
            PropertyId = propertyId;
        }

        public readonly Guid FormatId;
        public readonly uint PropertyId;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PropVariant
    {
        [FieldOffset(0)]
        public ushort VariantType;

        [FieldOffset(8)]
        public IntPtr PointerValue;
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig]
        int GetCount(out uint propertyCount);

        [PreserveSig]
        int GetAt(uint propertyIndex, out PropertyKey key);

        [PreserveSig]
        int GetValue(ref PropertyKey key, out PropVariant value);

        [PreserveSig]
        int SetValue(ref PropertyKey key, ref PropVariant value);

        [PreserveSig]
        int Commit();
    }

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern int SHGetPropertyStoreForWindow(
        IntPtr window,
        ref Guid interfaceId,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore? propertyStore
    );

    [DllImport("ole32.dll", PreserveSig = true)]
    private static extern int PropVariantClear(ref PropVariant value);
}
