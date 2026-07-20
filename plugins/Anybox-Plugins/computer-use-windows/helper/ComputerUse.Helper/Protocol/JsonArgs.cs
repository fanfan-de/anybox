using System.Globalization;
using System.Text.Json;

namespace ComputerUse.Helper.Protocol;

internal static class JsonArgs
{
    public static JsonElement Property(JsonElement value, string name)
    {
        if (value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property))
        {
            return property;
        }
        throw new ComputerUseException("CU_INVALID_ARGUMENT", $"Missing required parameter: {name}");
    }

    public static JsonElement PropertyOrDefault(JsonElement value, string name)
    {
        return value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property)
            ? property
            : default;
    }

    public static string String(JsonElement value, string name, bool required = false)
    {
        var property = PropertyOrDefault(value, name);
        if (property.ValueKind == JsonValueKind.String)
        {
            var result = property.GetString() ?? "";
            if (!required || result.Length > 0)
            {
                return result;
            }
        }
        if (required)
        {
            throw new ComputerUseException("CU_INVALID_ARGUMENT", $"Missing required parameter: {name}");
        }
        return "";
    }

    public static int Int32(JsonElement value, string name, int? fallback = null)
    {
        var property = PropertyOrDefault(value, name);
        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var number))
        {
            return number;
        }
        if (
            property.ValueKind == JsonValueKind.String
            && int.TryParse(property.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out number)
        )
        {
            return number;
        }
        if (fallback.HasValue)
        {
            return fallback.Value;
        }
        throw new ComputerUseException("CU_INVALID_ARGUMENT", $"{name} must be an integer.");
    }

    public static double Double(JsonElement value, string name, double? fallback = null)
    {
        var property = PropertyOrDefault(value, name);
        if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out var number))
        {
            return number;
        }
        if (fallback.HasValue)
        {
            return fallback.Value;
        }
        throw new ComputerUseException("CU_INVALID_ARGUMENT", $"{name} must be a number.");
    }

    public static bool Boolean(JsonElement value, string name, bool fallback)
    {
        var property = PropertyOrDefault(value, name);
        return property.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => fallback,
        };
    }

    public static string[] StringArray(JsonElement value, string name, int maxItems)
    {
        var property = Property(value, name);
        if (property.ValueKind != JsonValueKind.Array)
        {
            throw new ComputerUseException("CU_INVALID_ARGUMENT", $"{name} must be an array.");
        }
        var values = property
            .EnumerateArray()
            .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() ?? "" : "")
            .ToArray();
        if (values.Length == 0 || values.Length > maxItems || values.Any(string.IsNullOrWhiteSpace))
        {
            throw new ComputerUseException(
                "CU_INVALID_ARGUMENT",
                $"{name} must contain between one and {maxItems} non-empty strings."
            );
        }
        return values;
    }
}
