#!/usr/bin/env bash
#
# Emit GitHub Actions annotations from fugazi JSON output.
# Uses the workflow command syntax: ::error file=...,line=...::message
set -euo pipefail

RESULTS="${FUGAZI_RESULTS_FILE:-fugazi-results.json}"

if [[ ! -f "${RESULTS}" ]]; then
  echo "fugazi-action: results file ${RESULTS} not found" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "fugazi-action: jq is required for annotation; skipping" >&2
  exit 0
fi

jq -r '.issues[] |
  select(.severity == "error") |
  "::error file=\(.file),line=\(.startLine // .line // 1),col=\(.startColumn // .column // 1)::[\(.ruleId)] \(.message)"' \
  "${RESULTS}"

jq -r '.issues[] |
  select(.severity == "warn" or .severity == "warning") |
  "::warning file=\(.file),line=\(.startLine // .line // 1),col=\(.startColumn // .column // 1)::[\(.ruleId)] \(.message)"' \
  "${RESULTS}"
