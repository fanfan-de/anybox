using System.Buffers.Binary;
using System.Text.Json;

namespace ComputerUse.Helper.Protocol;

internal static class FrameProtocol
{
    private static readonly JsonDocumentOptions DocumentOptions = new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 64,
    };

    public static JsonDocument? Read(Stream input)
    {
        Span<byte> header = stackalloc byte[4];
        var headerRead = ReadAtMost(input, header);
        if (headerRead == 0)
        {
            return null;
        }
        if (headerRead != header.Length)
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                "Computer Use helper received a truncated frame header."
            );
        }

        var bodyLength = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(header));
        if (bodyLength <= 0 || bodyLength > BuildInfo.MaxFrameBytes)
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                $"Computer Use helper rejected frame length {bodyLength}."
            );
        }

        var body = GC.AllocateUninitializedArray<byte>(bodyLength);
        var bodyRead = ReadAtMost(input, body);
        if (bodyRead != bodyLength)
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                "Computer Use helper received a truncated frame body."
            );
        }

        try
        {
            return JsonDocument.Parse(body, DocumentOptions);
        }
        catch (JsonException error)
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                "Computer Use helper received invalid UTF-8 JSON.",
                innerException: error
            );
        }
    }

    public static void Write(Stream output, object payload, JsonSerializerOptions options)
    {
        var body = JsonSerializer.SerializeToUtf8Bytes(payload, options);
        if (body.Length <= 0 || body.Length > BuildInfo.MaxFrameBytes)
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                $"Computer Use helper response exceeded {BuildInfo.MaxFrameBytes} bytes."
            );
        }

        lock (output)
        {
            Span<byte> header = stackalloc byte[4];
            BinaryPrimitives.WriteUInt32LittleEndian(header, checked((uint)body.Length));
            output.Write(header);
            output.Write(body);
            output.Flush();
        }
    }

    private static int ReadAtMost(Stream input, Span<byte> buffer)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var read = input.Read(buffer[total..]);
            if (read == 0)
            {
                break;
            }
            total += read;
        }
        return total;
    }
}
