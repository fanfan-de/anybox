# Optional testsuite features

Enable only when the user asks. Re-run doctor after each change.

## Test impact analysis

[Set up test impact analysis](https://circleci.com/docs/guides/test/set-up-test-impact-analysis/). Coverage plugins exist for Vitest, Jest, Mocha, pytest, and RSpec. Selection tuning: `full-test-run-paths`, `test-selection-rules` in [config reference](https://circleci.com/docs/guides/test/testsuite-configuration-reference/#options).

**Vitest**

```yaml
analysis: CIRCLECI_COVERAGE=<< outputs.circleci-coverage >> vitest run --silent --bail 0 << test.atoms >>
options:
  test-impact-analysis: true
```

**Go** (with `file-mapper`)

```yaml
file-mapper: go list -json="Dir,ImportPath,TestGoFiles,XTestGoFiles" ./... > << outputs.go-list-json >>
analysis: go tool gotestsum -- -coverprofile="<< outputs.go-coverage >>" -cover -coverpkg ./... << test.atoms >>
options:
  test-impact-analysis: true
```

Do not commit local impact JSON under `.circleci/`. CI branch flags: `--select-tests`, `--analyze-tests`.

## Dynamic test splitting

```yaml
options:
  dynamic-test-splitting: true
```

Requires job `parallelism` greater than 1. [Doc](https://circleci.com/docs/guides/test/use-dynamic-test-splitting/).

## Auto rerun failed tests

```yaml
options:
  max-auto-rerun: 3
  # auto-rerun-duration: 5m
```

`max-auto-rerun` is 0–10. [Doc](https://circleci.com/docs/guides/test/auto-rerun-failed-tests/).
