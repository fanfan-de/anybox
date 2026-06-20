---
name: circleci-smarter-testing
description: Onboard onto CircleCI Smarter Testing (testsuite) with `.circleci/test-suites.yml`, config wiring, `circleci run testsuite`, and `--doctor` until checks pass. Use for Smarter Testing, testsuite, test-suites YAML, test impact analysis, dynamic test splitting, auto rerun failed tests, or migrating raw test commands.
---

# CircleCI Smarter Testing

## Overview

**Beta** ([Discuss](https://discuss.circleci.com/t/product-launch-smarter-testing-is-now-in-beta/54497)). Create or adjust `.circleci/test-suites.yml`, wire it into CI, and validate with `--doctor` until checks pass. Let doctor diagnose YAML, command, JUnit, and testsuite errors before adding extra guidance.

## Doctor command (required)

The testsuite CLI uses Bubble Tea and **must** run with a TTY. When iterating with `--doctor`, the agent **must always** run this exact command (substitute the suite name only):

```bash
script -q /dev/null circleci run testsuite "<suite name>" --doctor
```

Do not modify this command: no pipes, `tail`, redirects, backgrounding, or truncation.

**Scope:** testsuite setup and validation. Not legacy `circleci tests run` / timings-only JUnit tuning → **`circleci-config`** ([test-results-and-splitting.md](../config/references/test-results-and-splitting.md)). Primary doc: [Getting started](https://circleci.com/docs/guides/test/getting-started-with-smarter-testing/).

**Lazy references:** read only what the task needs—do not load every reference file up front.

- Runner YAML → [references/runners.md](references/runners.md) (matching section only)
- CI / `store_test_results` → [references/ci-and-junit.md](references/ci-and-junit.md)
- TIA, splitting, auto-rerun → [references/optional-features.md](references/optional-features.md)

## Inputs To Gather

- Runner, test root, existing `.circleci/config.yml`
- Optional: TIA, dynamic splitting, auto-rerun limits
- Hand off: **`circleci-cli`** (install/auth/plugin) | **`circleci-config`** (JUnit/`circleci tests run` without testsuite) | **`circleci-builds`** (CI fails after doctor-clean config)

## Workflow

1. **Inspect** — runner, layout, existing CI; reuse documented test commands; run testsuite from the test root (no `cd` in YAML).
2. **Baseline** — `.circleci/test-suites.yml` with `name`, `discover`, `run`, `outputs.junit` (see [runners.md](references/runners.md)).
3. **Doctor** — run the exact command above; apply its guidance; repeat until pass.
4. **Local vs CI** — Local needs [CLI](https://circleci.com/docs/guides/toolkit/local-cli/) + testsuite plugin (`brew install circleci/tap/circleci-testsuite` on macOS; [binaries](https://circleci.com/docs/guides/test/getting-started-with-smarter-testing/) on Linux/WSL). CI uses `circleci run testsuite` on executors + [ci-and-junit.md](references/ci-and-junit.md).
5. **Optional features** — only if asked; see [optional-features.md](references/optional-features.md); doctor after each change.
6. **Verify** — full `circleci run testsuite "<suite name>"`; optional TIA/rerun checks per docs.

## Guardrails

- Beta unless confirmed otherwise; never skip doctor after editing `test-suites.yml`.
- No secrets in YAML—use contexts/env vars; document variable names only.
- No local impact JSON in `.circleci/`; smallest change that passes doctor.
- Do not swap a working testsuite for legacy `circleci tests split` / `circleci tests run` unless the user requests migration.

## Reference map

- [runners.md](references/runners.md) — `test-suites.yml` template, Vitest, pytest, pointers for other runners
- [ci-and-junit.md](references/ci-and-junit.md) — full `config.yml`, JUnit directory upload
- [optional-features.md](references/optional-features.md) — TIA, splitting, auto-rerun
- [test-results-and-splitting.md](../config/references/test-results-and-splitting.md) — classic test metadata path

## Output Contract

Provide:

1. Runner, working directory, files changed, commands run (`--doctor` and follow-ups).
2. What to commit and open items (beta access, blocked prerequisites).
