---
name: onboarding
description: "Agent-driven onboarding guide for CircleCI. Walks a user through the full setup journey: account creation, org setup, GitHub App connection, project creation, pipeline definition + trigger, and iterating a config file until it passes. Use this skill whenever a user says \"onboard to CircleCI\", \"set up CircleCI\", \"get started with CircleCI\", \"connect my repo to CircleCI\", \"create a CircleCI project\", or asks for help with any early CircleCI setup step. Also trigger if the user has a new repo and wants CI running on it."
---

# CircleCI Onboarding

Guide the user through setting up CircleCI from scratch. Work through the
stages below **in order**. At each stage, use `AskUserQuestion` to collect
structured input rather than asking in prose — this keeps the flow crisp and
unambiguous. Run CLI commands to verify state before asking questions you can
answer yourself. Skip stages that are already complete.

---

## Stage 0: Check prerequisites

First, verify the CLI version:

```bash
circleci version
```

Extract the version number from the output (e.g. `circleci 0.1.2+...` → `0.1.2`).
If the major version is `0` (i.e. below `1.0.0`), stop and tell the user:

> "This onboarding flow requires CircleCI CLI version 1.0.0 or later.
> Your installed version is `<version>`. Please upgrade with:
>
> ```
> brew tap circleci-public/homebrew-circleci
> brew remove circleci
> brew install --cask circleci@next
> ```"

Do not proceed past this stage if the version check fails.

Then run `circleci auth me` before asking anything. If it returns a user, skip
Stage 1 and note the username.

---

## Stage 1: Account

If not authenticated, ask:

```
AskUserQuestion(
  "Are you new to CircleCI or do you already have an account?",
  header: "Account",
  options: [
    { label: "New — create an account", description: "Open signup in browser via circleci auth signup" },
    { label: "Existing — log in",        description: "Open login in browser via circleci auth login" }
  ]
)
```

Then run the appropriate command and verify with `circleci auth me`.

---

## Stage 2: Org

Ask:

```
AskUserQuestion(
  "Which CircleCI org do you want to use?",
  header: "Organization",
  options: [
    { label: "Use an existing org",  description: "I'll provide the org slug" },
    { label: "Create a new org",     description: "I'll walk you to app.circleci.com/organization-setup" }
  ]
)
```

- **Existing:** Ask for the slug via a follow-up text input (e.g. `gh/myorg` or
  `circleci/<uuid>`). Found at **Organization Settings → Organization slug**.
- **New:** Direct to `https://app.circleci.com/organization-setup`, wait for
  confirmation, then ask for the resulting slug.

Note the org slug — it's needed in every subsequent stage.

---

## Stage 3: GitHub App connection

Run `circleci project list` silently. If it returns repositories, the GitHub
App is already connected — skip to Stage 4.

If the list is empty or errors, ask:

```
AskUserQuestion(
  "Has the CircleCI GitHub App been installed on your GitHub org?",
  header: "GitHub App",
  options: [
    { label: "Yes, already installed", description: "Repos should be visible in CircleCI" },
    { label: "No, need to install it", description: "I'll guide you through the installation" }
  ]
)
```

For installation: direct to
`https://app.circleci.com/settings/organization/<vcs>/<orgname>/vcs`,
tell them to install the GitHub App and grant access to relevant repos,
then confirm by running `circleci project list` again.

---

## Stage 4: Project

Ask:

```
AskUserQuestion(
  "Which repository do you want to set up CI for?",
  header: "Repository",
  options: [
    { label: "A repo already in CircleCI (follow existing)", description: "circleci project follow" },
    { label: "A new repo (create project)",                  description: "circleci project create" }
  ]
)
```

For a new project, ask the repo name (default to current directory name if in
a git repo), then:

```bash
circleci project create <repo-name> --org <org-slug> --json
```

Then link the local checkout:
```bash
circleci project link
circleci project get --json   # verify and capture project UUID
```

Save the project `slug` (e.g. `gh/myorg/myrepo`) and `id` (UUID).

---

## Stage 5: Pipeline definition + trigger

You need the GitHub repo's numeric ID. Try:
```bash
gh api /repos/<owner>/<repo> --jq .id 2>/dev/null
```
If `gh` isn't available or fails, ask the user to provide it (it's the number
in `github.com/<owner>/<repo>` → **Settings → General**, shown as "Repository ID").

Ask which trigger preset to use, then immediately create both the definition
and trigger without any further confirmation:

```
AskUserQuestion(
  "What events should trigger this pipeline?",
  header: "Trigger",
  options: [
    { label: "All pushes + PRs (recommended)", description: "all-pushes preset — runs on every push to any branch and PR events" },
    { label: "Pull requests only",             description: "only-open-prs — runs on PR open/update" },
    { label: "Default branch only",            description: "default-branch-pushes — runs only on pushes to main/master" },
    { label: "All pushes",                     description: "all-pushes — runs on every push to any branch" }
  ]
)
```

Map the choice to `--event-preset`:
- "All pushes + PRs" → `all-pushes`
- "Pull requests only" → `only-open-prs`
- "Default branch only" → `default-branch-pushes`
- "All pushes" → `all-pushes`

Then immediately (no further confirmation needed):

```bash
# Create pipeline definition
circleci pipeline create \
  --project <project-slug> \
  --name "main" \
  --config-provider github_app \
  --config-repo-id <github-repo-id> \
  --config-file .circleci/config.yml \
  --checkout-provider github_app \
  --checkout-repo-id <github-repo-id> \
  --json

# Create trigger
circleci project trigger create \
  --pipeline-definition-id <definition-id> \
  --repo-id <github-repo-id> \
  --event-preset <chosen-preset> \
  --json
```

Save the pipeline definition `id`. Proceed directly to Stage 6.

---

## Stage 6: Config — create and iterate until green

### 6a — Config file

Check if `.circleci/config.yml` already exists. If not, auto-generate it
without asking — do not prompt the user for a config strategy:

```bash
circleci config generate
```

Then always validate:
```bash
circleci config validate
```
Fix any validation errors before proceeding.

**Important:** Before using `npm test` as a build step, check `package.json`
for a `"test"` script. If it's missing, use `npm run build` instead (common
for Next.js and other frontend-only projects with no test suite).

### 6b — Commit, push, and run

Do all of this automatically without waiting for user confirmation:

```bash
git add .circleci/config.yml
git commit -m "ci: add CircleCI config"
git push

# Capture the pipeline run ID from JSON output
circleci pipeline run \
  --project <project-slug> \
  --definition-id <definition-id> \
  --branch <current-branch> \
  --json
```

Extract the `id` field from the JSON response as `<run-id>`.

### 6c — Watch

Watch using the pipeline run UUID (not `--sha`, which only works for
push-triggered runs, not manually triggered ones):

```bash
circleci run watch <run-id> --project <project-slug> --failfast
```

- Exit `0` → pipeline passed, go to **Wrap-up**
- Exit `1` → failed, go to 6d
- Exit `6` → cancelled (ask user what happened)
- Exit `8` → timed out (check if jobs are stuck)

### 6d — Diagnose and fix (loop)

```bash
circleci logs --last-failed --project <project-slug>
```

Read the failure, identify the root cause, edit `.circleci/config.yml`,
explain the change briefly, then loop back to 6b. Common fixes:

| Symptom | Fix |
|---|---|
| `Missing script: "test"` | Replace `npm test` with `npm run build` |
| Command not found | Add install step or use a different Docker image |
| Test failures | Verify test command matches repo's actual test runner |
| Permission denied | `chmod +x` the script, or switch to a non-root image |
| Config schema error | Fix YAML per `circleci config validate` output |
| Missing env var | Add to project env vars via `circleci envvar` |

Repeat 6b–6d until exit `0`.

---

## Wrap-up

```bash
circleci run open <run-number>   # open the passing run in the browser
```

Tell the user:
- The trigger from Stage 5 means **future pushes fire automatically** — no
  manual `pipeline run` needed.
- Suggested next steps (offer as a question):

```
AskUserQuestion(
  "What would you like to set up next?",
  header: "Next steps",
  multiSelect: true,
  options: [
    { label: "Secrets / env vars",  description: "Store API keys safely with circleci envvar or contexts" },
    { label: "Test parallelism",    description: "Split tests across multiple containers to go faster" },
    { label: "Dependency caching",  description: "Cache node_modules / pip / gradle to speed up builds" },
    { label: "Orbs",                description: "Reusable config packages for common tools (AWS, Docker, etc.)" }
  ]
)
```

Then help with whatever they select.

---

## General guidance

- **Run CLI checks before asking.** If you can determine the answer yourself
  (auth status, project list, file existence), do it — don't ask the user.
- **Keep state.** Track org slug, project slug, project UUID, pipeline
  definition ID, and GitHub repo ID once discovered.
- **Use `--json`** on all commands that return IDs so values are easy to extract.
- **On failure**, surface the raw error, diagnose it, and propose a fix before
  retrying. Auth errors → `circleci auth login`. 404s → check project slug.
