# Model Providers

Anybox lets you select different large-language-model services through Provider and Model configuration.

## Where to Configure Providers

Open the model configuration area in desktop Settings, enter the provider credentials, and choose a default model. Individual sessions can also select a different model so each task can use an appropriate capability and cost level.

## Recommended Setup Order

1. Add one stable provider.
2. Select a default model.
3. Run a read-only question to verify the connection.
4. Add a stronger model for coding, refactoring, or long-context tasks.

If you are not sure where to start, configure one commonly used cloud provider and one everyday model. Add more models later as task complexity grows.

## Credential Security

Do not commit API keys to a repository. In a team environment, keep secrets in the local environment, an operating-system credential manager, or deployment environment variables.

```powershell
# Example: set an environment variable for the current PowerShell session only
$env:PROVIDER_API_KEY="your-api-key"
```

If you connect to an external agent service, verify that its address, network exposure, and authentication method meet your team's security requirements.

## Troubleshooting

If a model is unavailable, check:

- Whether the API key is valid.
- Whether the provider account has available credit.
- Whether the current network can reach the provider API.
- Whether the selected model ID is still available.
- Whether the session is connected to the intended local or remote agent service.
