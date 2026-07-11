# Desktop i18n rules

- Use `t("...")` for new application UI text, including button labels, headings, empty states, toasts, placeholders, `title`, `alt`, and `aria-label`.
- Keep product names, provider names, model names, commands, environment variables, paths, URLs, code, diffs, terminal output, user messages, and agent output in their original language.
- Preserve these English terms in Chinese UI when they are the clearest product or technical terms: Anybox, Agent, MCP, API key, JSON, URL, Shell, Terminal, Git, Pull Request, OpenAI, ChatGPT, and Codex.
- `translateLiteral()` is a compatibility fallback for old hardcoded UI text. Do not rely on it for new UI.
- Add values for every locale in `APP_LOCALES` when introducing a translation key. Translation tests and locale file types enforce key and placeholder alignment.
