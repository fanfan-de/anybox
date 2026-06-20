# `test-suites.yml` by runner

Read only the matching runner section. For other stacks, use [Getting started](https://circleci.com/docs/guides/test/getting-started-with-smarter-testing/) and the [config reference](https://circleci.com/docs/guides/test/testsuite-configuration-reference/).

## Template

```yaml
---
name: ci tests
discover: <command; one test atom per line on stdout>
run: <command; write JUnit to "<< outputs.junit >>"; include << test.atoms >>
outputs:
  junit: test-reports/tests.xml
```

## Vitest

```yaml
---
name: ci tests
discover: vitest list --filesOnly
run: vitest run --reporter=junit --outputFile="<< outputs.junit >>" --bail 0 << test.atoms >>
outputs:
  junit: test-reports/tests.xml
```

## pytest

```yaml
---
name: ci tests
discover: find ./tests -type f -name 'test*.py'
run: pytest --disable-pytest-warnings --no-header --quiet --tb=short --junit-xml="<< outputs.junit >>" << test.atoms >>
outputs:
  junit: test-reports/tests.xml
```

## Other runners (official starters)

Jest, Go, RSpec, and Mocha starters are in the getting-started guide. Copy the closest starter, preserve the repo's existing test command, and run doctor.
