# Fugazi GitLab CI template

Drop-in include template that runs Fugazi against a TypeScript or JavaScript
project, uploads a Code Climate JSON for the GitLab Code Quality widget, and
optionally posts inline MR discussion notes.

## Usage

In your project's `.gitlab-ci.yml`:

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/fugazi/fugazi/main/ci/.gitlab-ci.yml'

variables:
  FUGAZI_VERSION: 'latest'
  FUGAZI_FORMAT: 'codeclimate'
  FUGAZI_FAIL_ON_ISSUES: 'true'
```

## Variables

| Name | Default | Description |
| --- | --- | --- |
| `FUGAZI_VERSION` | `latest` | npm version of `fugazi` to install. |
| `FUGAZI_FORMAT` | `codeclimate` | Output format. The Code Climate format is required for the GitLab Code Quality widget. |
| `FUGAZI_FAIL_ON_ISSUES` | `true` | Exit non-zero when any issue is reported. |
| `FUGAZI_GITLAB_TOKEN` | (unset) | GitLab API token with `api` scope. Required to post MR discussion notes. |

The template reads only `FUGAZI_*` variables (none of `FALLOW_*`).

## What it does

1. Installs Fugazi from npm (Node 22 image; falls back to apt-get if Node is not present).
2. Runs `fugazi audit --format codeclimate --output gl-code-quality-report.json`.
3. Uploads the result via `artifacts.reports.codequality` so it lights up the
   GitLab Code Quality widget on the MR.
4. When the pipeline source is `merge_request_event` and a token is present,
   posts a single Markdown summary as an MR note plus per-finding inline
   discussions via the GitLab API.

## Tests

`ci/tests/*.bats` cover install + analyse + jq filters with stubbed binaries.
The same contracts are mirrored as Vitest tests in
`tests/distribution/__tests__/` so local CI can verify them without Bats.
