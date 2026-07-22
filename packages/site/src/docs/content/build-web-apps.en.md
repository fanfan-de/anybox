# Build Web Apps

Build Web Apps (`build-web-apps`) is a bundle of frontend-development Skills. It helps the agent move from product goals and visual direction through implementation and browser testing, with focused guidance for React performance, shadcn/ui, Stripe, and Supabase/Postgres when those technologies are relevant.

> This plugin supplies workflows and engineering guidance. It is not a hosting service and does not automatically connect payment accounts, databases, or production environments. File writes, commands, browser access, deployment, and external accounts still depend on the tools and connectors available to the project and follow their own approval policies.

## When to use it

Enable this plugin for tasks such as:

- Building a landing page, product site, dashboard, internal tool, or interactive frontend from scratch.
- Adding a complete user flow to an existing React or Next.js application.
- Reworking a UI from a screenshot, design, or brand direction while preserving responsive behavior.
- Diagnosing blank pages, runtime overlays, broken interactions, console errors, and mobile layout problems.
- Improving React rendering, data loading, bundle size, and perceived performance.
- Composing shadcn/ui correctly or planning safer Stripe and Supabase/Postgres integrations.

For a one-line copy change or a very small style fix, the agent can follow the existing design system directly without exploring an entirely new visual direction.

## Install and enable it for a project

1. Open **Plugins** from the Anybox navigation.
2. Search for `Build Web Apps` or `build-web-apps`, review the included Skills, and select **Install**.
3. Enable it from the current project's top-menu plugin selector.
4. Open the target repository and tell the agent how it runs, which page matters, the technology stack, and any boundaries it must preserve.
5. For real browser acceptance testing, also enable Chrome and start the local development server.

The plugin has no standalone MCP server or connector configuration. Installing it alone does not grant access to a browser, Stripe, Supabase, a deployment platform, or any other account.

## Included Skills

| Skill | Primary role |
| --- | --- |
| `frontend-app-builder` | Move from requirements and visual direction to a runnable frontend |
| `frontend-testing-debugging` | Verify page identity, console health, interactions, and responsive behavior in a browser |
| `react-best-practices` | Reduce request waterfalls, unnecessary rerenders, and bundle cost in React/Next.js |
| shadcn/ui best practices | Find, install, compose, and customize real shadcn/ui components |
| Stripe best practices | Apply safer patterns for payments, webhooks, and server boundaries |
| Supabase/Postgres best practices | Improve schema, queries, indexes, connections, and row-level security |

The relevant Skills guide each task; they do not force every listed technology into every project. A frontend without payments does not need Stripe, and a repository with an established component library should not migrate to shadcn/ui merely because this plugin is enabled.

## Recommended workflow

### 1. Define the outcome

State who the page serves, its primary action, required content, and completion criteria. For example:

> In this Vite + React project, implement a plugin documentation home page. Preserve the existing routes and brand colors. Use a left sidebar on desktop and a selector on narrow screens. Verify the home page, search, and both viewport sizes in Chrome. Do not deploy.

### 2. Inspect the existing project

The agent first reads the framework, scripts, components, style tokens, and existing pages so it can preserve the project's design language. For a new, visually significant surface, it may generate or compare visual directions when image generation is available. If you already have a design—or only want a small fix—tell it to use the existing system directly.

### 3. Establish a coherent visual system

Set typography, color, spacing, borders, radii, elevation, and responsive rules before composing the page. This avoids a UI built from many inconsistent one-off styles.

### 4. Implement a runnable version

The agent edits the current repository, preserves existing architecture and user changes, and runs the project's available formatter, type checks, or tests. It should explain the impact before adding dependencies, running migrations, or changing build configuration.

### 5. Verify the real page

When a development server is available, use Chrome to inspect the actual page instead of inferring the result from source code alone. At minimum, confirm:

- The browser is on the intended page, with no blank screen or framework error overlay.
- The console has no errors caused by the change.
- The target button, form, navigation, or filter completes the expected interaction.
- Desktop and narrow viewports have no obvious overflow, occlusion, or unreachable content.
- Final screenshots match the goal or design reference.

### 6. Make the handoff boundary explicit

The result should list changes, verification, and any remaining human configuration. Unless you explicitly request and authorize it, finishing the build does not mean deploying, publishing, submitting payment configuration, or modifying a production database.

## Write an effective request

- “Build a responsive product home page in this repository, reusing its tokens and components. Outline the page first, then implement and verify it in Chrome.”
- “Recreate this settings screenshot in the renderer only. Do not change IPC or the data model.”
- “Diagnose why the mobile menu does not open. Reproduce and explain the cause, then fix and verify it.”
- “Review this React page for request waterfalls, bundle cost, and unnecessary rerenders. Do not edit code.”
- “Design a Stripe integration for the current checkout. First define server, webhook, and idempotency boundaries; do not create real products or charges.”
- “Review these Supabase queries and RLS policies and suggest indexes and permission changes. Do not connect to or modify production.”

Also state the stack, target route, design reference, editable directories, verification commands, and whether the agent may install dependencies or contact external services.

## Browser testing and Chrome

`frontend-testing-debugging` prefers verification in a real browser when browser capability is available. Chrome can read the current page, inspect console and page structure, perform interactions, and preserve screenshots. It is particularly useful for local development sites and dashboards that rely on an existing signed-in session.

If Chrome is unavailable, the agent can use testing support already present in the repository. A successful build only proves that the output compiles, however; it does not replace inspecting layout and interaction behavior.

## Payment, database, and external-service boundaries

- The Stripe Skill is implementation guidance. It does not grant Stripe credentials or independently create products, prices, or charges.
- The Supabase/Postgres Skill is database design and performance guidance. It does not connect to or modify a database by itself.
- Store credentials in Anybox's secure configuration or the platform's recommended secret manager, never in source, Markdown, screenshots, or commits.
- Database migrations, production writes, real payments, deployments, and publishing are separate actions. Name the target environment and approve each action explicitly.
- Signed-in browser state is available only when Chrome is enabled and you allow use of the relevant tab. Installing Build Web Apps does not read browser sessions.

## Troubleshooting

### No new tool appears after installation

This is expected. Build Web Apps is a Skill bundle and declares no MCP server or connector of its own. It improves how the agent approaches frontend work, while execution still uses the project's existing file, command, image, and browser capabilities.

### The agent wants a redesign, but the task is a small fix

Say “preserve the existing design system and do not explore a new visual direction,” then limit the editable component or files. Small corrective changes do not need a full concept phase.

### The page builds but looks wrong

Start the development server and enable Chrome. Ask the agent to open the exact route and check page identity, console output, a screenshot, and the target interaction. Include at least one narrow viewport.

### Stripe or Supabase is mentioned, but no account is connected

The plugin only supplies best practices. Real operations require separately configured credentials and a suitable tool, with the development, test, or production environment named explicitly. Until then, the agent should remain at the code and design level.

### The project already uses another component library

Keep using the existing library. shadcn/ui guidance is optional, not a migration requirement; consistency is normally more valuable than introducing a second component system.

## Use it with other plugins

- Use **Chrome** for real QA of local pages, signed-in dashboards, and responsive layouts.
- After organizing a film project with **anybox for cinema**, use this plugin to build an asset-review surface or showcase.
- Use **Computer Use Windows** only when the task must operate native desktop software.

## Next steps

Read **Chrome** for browser acceptance testing, **Skills** for how specialist workflows enter a task, and **Permissions & Approvals** for authorization boundaries around dependencies, external services, and production actions.
