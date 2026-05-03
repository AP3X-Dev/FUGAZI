#!/usr/bin/env bats
#
# Bats tests for the GitLab jq filters under ci/jq/.

setup() {
  HERE="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
  ROOT="${HERE}/.."
  SAMPLE="${HERE}/fixtures/sample-issues.json"
  EMPTY="${HERE}/fixtures/empty-issues.json"
}

@test "review-body.jq renders header" {
  run jq -rf "${ROOT}/jq/review-body.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"## Fugazi report"* ]]
}

@test "review-comments-check.jq emits position objects" {
  run jq -cf "${ROOT}/jq/review-comments-check.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  count=$(echo "${output}" | jq 'length')
  [ "${count}" -eq 1 ]
  ptype=$(echo "${output}" | jq -r '.[0].position.position_type')
  [ "${ptype}" = "text" ]
}

@test "review-comments-dupes.jq expands clone instances" {
  run jq -cf "${ROOT}/jq/review-comments-dupes.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  count=$(echo "${output}" | jq 'length')
  [ "${count}" -eq 2 ]
}

@test "review-comments-health.jq filters by category=health" {
  run jq -cf "${ROOT}/jq/review-comments-health.jq" "${SAMPLE}"
  [ "${status}" -eq 0 ]
  count=$(echo "${output}" | jq 'length')
  [ "${count}" -eq 1 ]
}

@test "all jq filters return [] on empty input" {
  for f in review-body.jq review-comments-check.jq review-comments-dupes.jq review-comments-health.jq; do
    run jq -f "${ROOT}/jq/${f}" "${EMPTY}"
    [ "${status}" -eq 0 ]
  done
}
