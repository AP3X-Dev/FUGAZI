#!/usr/bin/env bash
#
# Run `fugazi audit` and emit results to fugazi-results.json. Sets two
# step outputs (results-file, issue-count) for downstream steps and exits
# non-zero when FUGAZI_FAIL_ON_ISSUES is "true" and findings exist.
set -euo pipefail

RESULTS="fugazi-results.json"
FORMAT="${FUGAZI_FORMAT:-json}"
FAIL="${FUGAZI_FAIL_ON_ISSUES:-true}"

# Always emit JSON for downstream tooling. If user asked for a different
# format, honour it for a second pass at stdout for the run log.
fugazi audit --format json --output "${RESULTS}"

# Optional second pass: human-readable run log.
if [[ "${FORMAT}" != "json" ]]; then
  fugazi audit --format "${FORMAT}" || true
fi

# Compute issue count (jq required).
if command -v jq >/dev/null 2>&1; then
  ISSUE_COUNT=$(jq '[.issues // [] | .[]] | length' "${RESULTS}")
else
  ISSUE_COUNT=$(grep -c '"ruleId"' "${RESULTS}" || echo "0")
fi

echo "results-file=${RESULTS}" >> "${GITHUB_OUTPUT:-/dev/stderr}"
echo "issue-count=${ISSUE_COUNT}" >> "${GITHUB_OUTPUT:-/dev/stderr}"

echo "fugazi-action: ${ISSUE_COUNT} issue(s) reported"

if [[ "${FAIL}" == "true" && "${ISSUE_COUNT}" -gt 0 ]]; then
  exit 1
fi
