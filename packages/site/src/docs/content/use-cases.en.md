# Use Cases

The Anybox workflow stays consistent: select a project, create a session, state the goal, inspect execution, and verify the result. What changes is the project context, the capabilities you allow, and the final deliverable.

## What This Page Is For

The scenarios below help you choose a well-scoped first task. They are not promises that every configuration supports every action; results depend on the project, model, tools, permissions, and connected extensions.

Prefer work that you can verify independently, and state at the beginning what may be read and what may be changed.

## Software Development

Start with a specific problem or a change that has a clear verification path:

- Explain the directory structure and relationships between important modules.
- Trace an error message to the relevant code path.
- Add tests for existing behavior.
- Refactor a local module while preserving its current interface.
- Summarize changes and prepare a commit or pull request description.

Example request:

> Read the project entry points and test configuration. Explain the structure without changing files, then list the three risks that deserve attention first.

After reviewing the proposed approach, authorize writing and testing as a separate step. This keeps project understanding and project mutation in two inspectable phases.

## Research and Office Work

When the source material is already in the workspace, an agent can:

- Organize meeting notes or research material by topic.
- Compare the goals, costs, risks, and open questions of several options.
- Extract verifiable findings from tables or text sources.
- Turn scattered notes into an outline, proposal, or action list.
- Prepare a communication summary while leaving sending or publishing to you.

Example request:

> Read the material in the research directory and create a Markdown summary organized as confirmed facts, disagreements, missing information, and recommended next steps. Do not access files outside that directory.

If the task uses an external service, first review what data the connection sends and whether credentials are required.

## Content and Creation

Anybox can advance creative work around existing project material:

- Turn verified product facts into website copy or documentation drafts.
- Expand an outline into an article, script, or presentation structure.
- Compare several directions and explain their tradeoffs.
- Revise the same project file in response to feedback.
- Break a complex deliverable into inspectable stages and checklists.

Example request:

> Using the product notes in this directory, draft a restrained, fact-based Chinese introduction. Do not add capabilities that are absent from the sources, and list claims that still need confirmation separately.

Generated text can sound fluent while still being wrong. Before publishing, verify names, numbers, links, platform status, and capability boundaries.

## Recommended Steps

1. Choose a task whose result can be tested, compared, or checked item by item.
2. Place the required source material in a clear project directory.
3. State the goal, read and write boundaries, output format, and completion criteria.
4. Ask the agent to inspect and propose a plan before authorizing mutation.
5. Review tool calls, file changes, errors, and the final response.
6. Run the checks appropriate to the project or manually verify critical facts.
7. Turn a successful workflow into a Skill for future tasks of the same kind.

## What Success Looks Like

- The output answers the original goal without treating adjacent ideas as authorized work.
- Important conclusions trace back to project files, tool results, or explicit user input.
- When files change, the scope matches the stated task boundary.
- Unverified information is labeled instead of being presented as fact.
- The result contains an actionable next step or an inspectable deliverable.

## Data and Permission Impact

Local files, terminal commands, and external connections have different capability boundaries. A read-only task may still send selected content to the current model, and a remote MCP tool may send its arguments to the corresponding service.

Before using real business material, remove unnecessary secrets, personal information, and restricted data. Apply stricter review to deletion, overwrite, publishing, or external write operations.

## Common Questions

### How detailed should a task be?

At minimum, state the goal, allowed scope, whether changes are permitted, the expected format, and the completion criteria. Ask for a plan first when the work is complex.

### Can one session handle many unrelated tasks?

The conversation can continue, but separating goals into sessions usually keeps context clearer and makes results easier to review later.

### What if the agent does not proceed as expected?

Check whether the model is available, the source material is in the active project, the required tools are enabled, and a permission request is still waiting for a decision.

## Next Steps

After choosing a scenario, read Projects, Workspaces & Sessions to organize context, then use Permissions & Approvals to define execution boundaries.
