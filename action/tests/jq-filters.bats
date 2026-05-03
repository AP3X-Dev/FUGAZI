#!/usr/bin/env bats
#
# Bats tests for every committed jq filter under action/jq/.

setup() {
  HERE="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
  ROOT="${HERE}/.."
  SAMPLE="${HERE}/fixtures/sample-issues.json"
  EMPTY="${HERE}/fixtures/empty-issues.json"
}

@test "summary-dupes.jq lists clone families" {
  run jq -rf "${ROOT}/jq/summary-dupes.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"## Duplication summary"* ]]
  [[ "${output}" == *"**Clone families:** 1"* ]]
  [[ "${output}" == *"F1"* ]]
}

@test "summary-dupes.jq says 'No clone families' on empty input" {
  run jq -rf "${ROOT}/jq/summary-dupes.jq" "${EMPTY}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"No clone families detected."* ]]
}

@test "summary-fix.jq lists fixable issues only" {
  run jq -rf "${ROOT}/jq/summary-fix.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"unused-export"* ]]
  [[ "${output}" == *"unused-deps"* ]]
  [[ "${output}" != *"complexity"* ]]
}

@test "review-comments-check.jq filters to category=check" {
  run jq -cf "${ROOT}/jq/review-comments-check.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  count=$(echo "${output}" | jq 'length')
  [ "${count}" -eq 2 ]
}

@test "review-comments-health.jq filters to category=health" {
  run jq -cf "${ROOT}/jq/review-comments-health.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  count=$(echo "${output}" | jq 'length')
  [ "${count}" -eq 1 ]
}

@test "merge-comments.jq deduplicates by (path,line,body)" {
  INPUT='[
    {"path":"a.ts","line":1,"body":"x"},
    {"path":"a.ts","line":1,"body":"x"},
    {"path":"a.ts","line":2,"body":"x"}
  ]'
  run bash -c "echo '${INPUT}' | jq -f '${ROOT}/jq/merge-comments.jq'"
  [ "${status}" -eq 0 ]
  count=$(echo "${output}" | jq 'length')
  [ "${count}" -eq 2 ]
}
