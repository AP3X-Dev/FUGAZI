#!/usr/bin/env bash
#
# Run fugazi audit and produce a Code Climate JSON for GitLab's Code Quality
# widget. Also emits a JSON copy for downstream MR-review processing.
set -euo pipefail

CC_OUT="gl-code-quality-report.json"
JSON_OUT="fugazi-results.json"
FAIL="${FUGAZI_FAIL_ON_ISSUES:-true}"

fugazi audit --format codeclimate --output "${CC_OUT}"
fugazi audit --format json --output "${JSON_OUT}"

if command -v jq >/dev/null 2>&1; then
  ISSUE_COUNT=$(jq '[.issues // [] | .[]] | length' "${JSON_OUT}")
else
  ISSUE_COUNT=$(grep -c '"ruleId"' "${JSON_OUT}" || echo "0")
fi

echo "fugazi-ci: ${ISSUE_COUNT} issue(s) reported"

if [[ "${FAIL}" == "true" && "${ISSUE_COUNT}" -gt 0 ]]; then
  exit 1
fi
