# Model Providers

Anybox uses a Provider to connect to a model service and a Model to choose the capabilities, context window, and billing profile used by a session. Keeping these settings separate makes it possible to use different services within one project.

## Configuration Pages

- Open **Settings → Providers** to manage sign-in, API keys, API base URLs, and connection tests.
- Open **Settings → Models** to select the global primary and small models and inspect models exposed by connected providers.
- Use the model control at the top of a session to override the global choice for that session only.

Provider and model catalogs are dynamic. Models, capabilities, status, and pricing metadata can change with models.dev, provider APIs, and Anybox releases, so a static list is not a permanent availability guarantee.

## Connect a First Provider

1. Open **Settings → Providers**.
2. Select a provider from the list; search or filter by name, capability, or connection state if needed.
3. Sign in or enter an API key using the method shown for that provider.
4. Enter a custom API base URL if you use a proxy, private gateway, or compatible service.
5. Save the settings, then select **Test connection**.
6. After a successful test, open **Settings → Models** and select a primary model.
7. Return to a project and create a read-only session to verify the complete path.

The setup is successful when the provider shows a connected state, its test passes, and its exposed models appear on the Models page.

## Connection Methods

The exact choices are provider-specific. Common entries include:

- Anybox account: complete sign-in in the system browser.
- OpenAI: ChatGPT Pro/Plus browser sign-in, device-code sign-in, or an API key.
- Other catalog providers: usually an API key, with a provider-specific environment variable when shown.
- Custom providers: a custom endpoint, API key, and model ID.

After browser or device-code authentication, return to Anybox and verify the final state. Closing the browser page alone does not prove that the desktop app received a usable session.

## Choose a Model

The Models page displays catalog metadata such as reasoning, tool use, vision or image output, context limits, and output limits when available.

- The primary model is used for normal sessions.
- The small model can handle lightweight work such as title generation; fallback behavior depends on the current configuration.
- Reasoning effort only affects models that support it.
- Deprecated, disconnected, or undisclosed models should not be used as defaults.

Verify a routine model with a read-only request first, then select a more suitable model for long context, complex refactoring, or multimodal work.

## Add a Custom Endpoint

1. Select **Add custom provider** on the Providers page.
2. Enter a clear, stable provider name.
3. Enter the complete API base URL and verify that it uses a protocol compatible with the target service.
4. Add the API key, default model, and chat endpoint as required.
5. Save the provider and immediately run **Test connection**.

A custom endpoint may point to a team gateway or a compatible service running locally, but Anybox does not bundle a local model inference engine. Authentication, logging, retention, and network exposure are controlled by that endpoint.

## Credential and Data Boundaries

- Never put an API key in project files, Skills, prompts, or a Git repository.
- Provider credentials saved manually are kept in agent-managed application data on this computer, with file access restricted where the operating system supports it.
- This is not a promise of operating-system keychain storage, hardware-backed protection, or additional file encryption. High-security environments should prefer controlled environment variables, protected accounts, or an independently managed agent deployment.
- When the interface offers an environment variable, use the provider-specific name shown there instead of storing the value in repository configuration.
- **Test connection** sends a validation request to the provider or custom endpoint.
- Normal sessions send prompts, required context, and agent-selected file or tool content to the active model service.

When using a custom endpoint or external agent, also review its network visibility, TLS, authentication, and organizational data policy.

## Troubleshooting

- No models are available: verify that the provider is connected, refresh the provider catalog, then revisit Models.
- The API key is rejected: check that it is complete and current, the account has credit, and the key can access the selected model.
- Browser sign-in remains pending: return to Anybox to check the state; disconnect and retry, or use device-code sign-in.
- A custom endpoint returns 404: check whether the base URL contains too much or too little API path and confirm protocol compatibility.
- The connection test passes but a session fails: check the exact model ID, context limits, regional restrictions, rate limits, and provider status.
- Catalog refresh fails: keep the existing cache and retry later; inspect proxy, firewall, and system-time settings.
- A session still uses an old model: inspect the session-level override in addition to the global Models setting.

## Next Steps

After the connection is stable, compare model latency and tool behavior with read-only tasks, then configure project conventions with **Skills**. Add MCP or plugins only when an external workflow requires them, using the least access necessary.
