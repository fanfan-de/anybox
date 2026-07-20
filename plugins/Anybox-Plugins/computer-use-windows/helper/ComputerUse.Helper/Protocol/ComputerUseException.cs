namespace ComputerUse.Helper.Protocol;

internal sealed class ComputerUseException : Exception
{
    public ComputerUseException(
        string code,
        string message,
        bool retryable = false,
        bool requiresFreshState = false,
        bool effectMayHaveOccurred = false,
        Exception? innerException = null
    ) : base(message, innerException)
    {
        Code = code;
        Retryable = retryable;
        RequiresFreshState = requiresFreshState;
        EffectMayHaveOccurred = effectMayHaveOccurred;
    }

    public string Code { get; }

    public bool Retryable { get; }

    public bool RequiresFreshState { get; }

    public bool EffectMayHaveOccurred { get; }
}
