using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using ComputerUse.Helper.Windows;

namespace ComputerUse.Helper.Protocol;

internal sealed partial class HostBrokerConnection : IDisposable
{
    private const int MaxTokenBytes = 128;
    private readonly NamedPipeServerStream _pipe;
    private byte[]? _expectedToken;

    private HostBrokerConnection(NamedPipeServerStream pipe, byte[] expectedToken, int brokerPid)
    {
        _pipe = pipe;
        _expectedToken = expectedToken;
        BrokerPid = brokerPid;
    }

    public int BrokerPid { get; }

    public Stream Stream => _pipe;

    public static HostBrokerConnection? TryAccept(string[] args)
    {
        if (args.Length == 0)
        {
            return null;
        }
        if (
            args.Length != 4
            || args[0] != "--broker-pipe"
            || args[2] != "--broker-pid"
            || !PipeNamePattern().IsMatch(args[1])
            || !int.TryParse(args[3], out var brokerPid)
            || brokerPid <= 0
        )
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                "Computer Use helper received invalid broker startup arguments."
            );
        }
        if (NativeMethods.GetParentProcessId(Environment.ProcessId) != brokerPid)
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                "Computer Use helper broker parent identity did not match."
            );
        }

        var expectedToken = ReadStartupToken(Console.OpenStandardInput());
        var pipe = new NamedPipeServerStream(
            args[1],
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.CurrentUserOnly | PipeOptions.WriteThrough
        );
        try
        {
            pipe.WaitForConnection();
            if (
                !NativeMethods.GetNamedPipeClientProcessId(
                    pipe.SafePipeHandle,
                    out var clientPid
                )
                || clientPid != checked((uint)brokerPid)
            )
            {
                throw new ComputerUseException(
                    "CU_PROTOCOL_MISMATCH",
                    "Computer Use helper rejected an unexpected pipe client."
                );
            }
            return new HostBrokerConnection(pipe, expectedToken, brokerPid);
        }
        catch
        {
            CryptographicOperations.ZeroMemory(expectedToken);
            pipe.Dispose();
            throw;
        }
    }

    public void AssertAndConsumeToken(string suppliedToken)
    {
        var expected = Interlocked.Exchange(ref _expectedToken, null);
        if (expected is null)
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                "Computer Use broker token has already been consumed."
            );
        }
        var supplied = Encoding.UTF8.GetBytes(suppliedToken);
        try
        {
            if (
                expected.Length != supplied.Length
                || !CryptographicOperations.FixedTimeEquals(expected, supplied)
            )
            {
                throw new ComputerUseException(
                    "CU_PROTOCOL_MISMATCH",
                    "Computer Use broker authentication failed."
                );
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(expected);
            CryptographicOperations.ZeroMemory(supplied);
        }
    }

    public void Dispose()
    {
        var token = Interlocked.Exchange(ref _expectedToken, null);
        if (token is not null)
        {
            CryptographicOperations.ZeroMemory(token);
        }
        _pipe.Dispose();
    }

    private static byte[] ReadStartupToken(Stream input)
    {
        var bytes = new List<byte>(64);
        while (bytes.Count <= MaxTokenBytes)
        {
            var next = input.ReadByte();
            if (next == -1 || next == '\n')
            {
                break;
            }
            if (next != '\r')
            {
                bytes.Add(checked((byte)next));
            }
        }
        if (bytes.Count < 32 || bytes.Count > MaxTokenBytes)
        {
            throw new ComputerUseException(
                "CU_PROTOCOL_MISMATCH",
                "Computer Use broker startup token was missing or invalid."
            );
        }
        return bytes.ToArray();
    }

    [GeneratedRegex("^anybox-cu-[a-f0-9]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex PipeNamePattern();
}
