# Model Providers

A Provider connects Anybox to a model service. A Model determines the capabilities, context window, and billing profile used by a session.

## Configure a Model

1. Open **Settings → Providers**, choose a provider, and sign in or enter an API key.
2. Add an API base URL when using a proxy, team gateway, or compatible service.
3. Save and run **Test connection**.
4. Open **Settings → Models** and choose a primary and optional small model.
5. Create a read-only project session to verify the complete path.

The model control at the top of a session can override the global setting. Provider catalogs update dynamically, so a static model list is not a long-term availability guarantee.

## Choose a Model

The Models page may list reasoning, tool-use, vision, context, and output capabilities.

- The primary model handles normal work; the small model suits lightweight tasks such as titles.
- Reasoning effort affects only models that support it.
- Select matching capabilities for long context, complex refactoring, or multimodal work.
- Do not use deprecated, disconnected, or account-inaccessible models as defaults.

## Custom Endpoints

Select **Add custom provider**, enter a name, complete API base URL, credentials, and model ID, then test immediately. Anybox does not bundle a local inference engine. The operator of a local service or team gateway owns its authentication, logging, retention, and network security.

## Credentials and Data

- Never put keys in projects, prompts, Skills, or Git repositories.
- Manually saved credentials live in local agent-managed data; do not assume operating-system keychain storage or additional encryption.
- **Test connection** and normal sessions contact the target service. Sessions also send prompts, context, and task-relevant file or tool content.

## Troubleshooting

- **No models:** confirm the connection, refresh the catalog, and revisit Models.
- **Credential rejected:** check completeness, expiry, credit, and model access.
- **Custom endpoint returns 404:** verify the API path and protocol compatibility.
- **Test passes but session fails:** check the model ID, context, region, rate limits, and session-level override.
