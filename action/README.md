# Fugazi GitHub Action

Composite action that runs Fugazi against a TypeScript or JavaScript project,
emits inline annotations, posts a sticky PR comment + inline review, and
optionally uploads a SARIF report to GitHub Code Scanning.

## Usage

```yaml
name: Fugazi
on: [push, pull_request]
jobs:
  fugazi:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: fugazi/action@v1
        with:
          fugazi-version: 'latest'
          format: 'json'
          fail-on-issues: 'true'
          comment-on-pr: 'true'
          upload-sarif: 'true'
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `fugazi-version` | no | `latest` | npm version of `fugazi` to install. |
| `working-directory` | no | `.` | Project root the analysis runs against. |
| `format` | no | `json` | Output format. One of `human`, `human-plain`, `json`, `sarif`, `compact`, `markdown`, `codeclimate`. |
| `fail-on-issues` | no | `true` | Exit non-zero when any issue is reported. |
| `comment-on-pr` | no | `true` | Post a sticky Markdown summary + inline review on PR builds. |
| `upload-sarif` | no | `true` | Upload a SARIF file to GitHub Code Scanning. |
| `runtime-coverage` | no | `false` | Attach V8 runtime coverage as evidence (requires test run with coverage). |

## Outputs

| Name | Description |
| --- | --- |
| `results-file` | Path to the JSON results file (relative to working directory). |
| `issue-count` | Total number of issues found. |

## Environment variables

The action reads only `FUGAZI_*` environment variables (none of `FALLOW_*`).
The internal scripts forward `FUGAZI_VERSION`, `FUGAZI_FORMAT`,
`FUGAZI_FAIL_ON_ISSUES`, `FUGAZI_RESULTS_FILE`, `FUGAZI_RUNTIME_COVERAGE`.

## Tests

`action/tests/*.bats` are run by Bats in CI. They are mirrored as Vitest
tests in `tests/distribution/__tests__/` so local CI can verify the same
contracts without Bats installed.
