# Overview

The first sentence is mine.

Anybox is an open-source desktop AI agent workspace for local projects. It brings project files, sessions, models, tool calls, and permission decisions into one inspectable workspace so an agent can do more than answer questions: it can keep moving a real project forward.

## What Anybox Is For

Anybox is useful when work depends on real files, persistent context, and executable tools. An agent can read a project, find information, run commands, change content, and leave the process and results in the same session for review.

Common directions include:

- Software development: understand code, locate issues, add tests, refactor modules, and prepare delivery notes.
- Research and office work: organize sources, compare information, analyze data, and produce a plan or action list.
- Content and creation: turn an idea into copy, scripts, page drafts, and an executable project plan.

The exact capabilities vary with the operating system, workspace, model, enabled tools, MCP connections, and installed plugins.

## The Core Workflow

Anybox organizes work around projects and sessions:

- A project provides the file directory and working boundary.
- A session preserves one continuing collaboration with an agent.
- A model interprets the goal and proposes the next action.
- Tools read, search, execute, or modify.
- The permission flow pauses execution when a decision is required.
- Skills and plugins add reusable rules and capabilities.

## Start a Task

1. Open a local project directory that you understand.
2. Connect a model provider in Settings and select a model.
3. Create a session and state the goal, constraints, and expected result.
4. Follow responses, tool calls, command output, and file changes.
5. When a permission request appears, review its target, paths, command, and risk.
6. Refine the request after reviewing the result, or finish when the outcome is verified.

For a first run, begin with a read-only task such as asking the agent to explain the project structure or locate a configuration entry.

## What Success Looks Like

A healthy Anybox workflow usually has these signs:

- The agent can identify the active project and intended outcome.
- Tool calls and results remain available in the current session for inspection.
- Sensitive execution or write operations present a clear permission decision when required.
- The final response distinguishes completed work, incomplete work, and items that need your review.
- Existing history is available again after switching away from and back to a session.

You still decide whether the result is correct based on project goals, tests, and business requirements.

## Data and Permission Impact

Opening a project makes its directory the current context, but it does not approve every possible operation. Tool availability, agent policy, session restrictions, and call-level permission checks all affect whether an action can run.

When you use a cloud model or remote MCP service, relevant request data may leave the device. Review the service address, authentication method, and whether the task contains information that should not be shared.

Do not place API keys, access tokens, passwords, or private account details directly in sessions, project files, Skills, or plugin examples.

## Common Questions

### Is Anybox only a chat application?

No. A session is the interaction surface, while project context, tool execution, permission review, and change inspection form the complete workflow.

### Will Anybox change my project automatically?

Files may change only when the task uses write capabilities and the relevant restrictions allow the operation. State a read-only requirement when needed and inspect changes after execution.

### Must every task use the same model?

No. Select a model according to task complexity, context length, cost, and provider availability.

### Does all data stay on my device?

Not necessarily. Local project files remain in your workspace, but cloud models, remote agent services, or external connections may receive data required for the task.

## Next Steps

Use Quick Start to complete a first project session, then continue with Model Providers, Tool System, Permissions and Approvals, and Skills as needed.
