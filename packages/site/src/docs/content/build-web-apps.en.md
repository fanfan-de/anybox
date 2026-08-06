# Build Web Apps

`build-web-apps` is a frontend-development Skill bundle covering product definition, implementation, browser acceptance testing, and React optimization, with optional guidance for shadcn/ui, Stripe, and Supabase/Postgres.

> It supplies workflows, not hosting, accounts, or production access. Files, commands, browsers, and external services still depend on available tools and permissions.

## Install and Scope

Install `build-web-apps` from Plugins and enable it for the current project. For real-page acceptance testing, also enable Chrome and start the development server.

Use it to build pages, implement complete user flows, recreate designs, fix interaction or responsive issues, and improve React performance. For a small copy or style change, preserve the existing design system directly.

## Included Skills

| Skill | Purpose |
| --- | --- |
| `frontend-app-builder` | Move from requirements and visual direction to a runnable frontend |
| `frontend-testing-debugging` | Check page identity, console, interactions, and responsive behavior |
| `react-best-practices` | Improve requests, rendering, and bundle size |
| shadcn/ui | Compose and customize components |
| Stripe | Payments, webhooks, and server boundaries |
| Supabase/Postgres | Schema, queries, indexes, and RLS |

Use only the Skills relevant to the task. The bundle does not require migration from an existing component library or automatically connect accounts.

## Recommended Workflow

1. **Define the outcome:** name the user, primary action, required content, and completion criteria.
2. **Inspect the project:** read the framework, scripts, components, style tokens, and existing pages.
3. **Implement:** preserve the architecture; explain impact before adding dependencies or changing build configuration.
4. **Verify:** run type checks and tests, then inspect the real page for console errors, target interactions, and desktop and narrow layouts.
5. **Hand off:** list changes, verification results, and remaining human configuration.

Example:

> In this Vite + React project, implement a plugin documentation home page. Preserve routes and brand colors; use a sidebar on desktop and a selector on narrow screens. Verify search and both viewports in Chrome. Do not deploy.

## External-Service Boundaries

- Stripe and Supabase Skills provide implementation guidance; they do not grant credentials or production access.
- Store secrets in secure configuration, never source, Markdown, screenshots, or commits.
- Database migrations, real payments, production writes, deployment, and publication require a separately named environment and confirmation.
- A successful build proves compilation, not correct layout or interaction.

It is normal for no new tool to appear after installation: this is a Skill bundle with no standalone MCP server or connector.
