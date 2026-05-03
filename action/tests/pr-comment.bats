#!/usr/bin/env bats
#
# Bats tests for the pr-comment.sh sticky-comment posting logic. We do not
# hit the real GitHub API; instead we exercise the Markdown body generator
# (review-body.jq) against fixtures.

setup() {
  HERE="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
  ROOT="${HERE}/.."
  SAMPLE="${HERE}/fixtures/sample-issues.json"
  EMPTY="${HERE}/fixtures/empty-issues.json"
}

@test "review-body.jq renders header and totals" {
  run jq -rf "${ROOT}/jq/review-body.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"## Fugazi report"* ]]
  [[ "${output}" == *"**Total issues:** 3"* ]]
}

@test "review-body.jq says 'No issues found' on empty input" {
  run jq -rf "${ROOT}/jq/review-body.jq" "${EMPTY}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"No issues found."* ]]
}

@test "review-body.jq lists rule, file, line, severity columns" {
  run jq -rf "${ROOT}/jq/review-body.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"| Rule | File | Line | Severity |"* ]]
  [[ "${output}" == *"unused-export"* ]]
}
