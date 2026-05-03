#!/usr/bin/env bats
#
# Bats tests for the annotate.sh workflow-command emitter.
# These tests are also mirrored as Vitest cases in
# tests/distribution/__tests__/ to cover environments without bats.

setup() {
  HERE="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
  ROOT="${HERE}/.."
  SAMPLE="${HERE}/fixtures/sample-issues.json"
  EMPTY="${HERE}/fixtures/empty-issues.json"
}

@test "annotate.sh emits ::error for severity=error" {
  FUGAZI_RESULTS_FILE="${SAMPLE}" run bash "${ROOT}/scripts/annotate.sh"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"::error file=src/foo.ts,line=12,col=14::[unused-export]"* ]]
}

@test "annotate.sh emits ::warning for severity=warn" {
  FUGAZI_RESULTS_FILE="${SAMPLE}" run bash "${ROOT}/scripts/annotate.sh"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"::warning file=src/bar.ts"* ]]
  [[ "${output}" == *"[complexity]"* ]]
}

@test "annotate.sh emits nothing for empty results" {
  FUGAZI_RESULTS_FILE="${EMPTY}" run bash "${ROOT}/scripts/annotate.sh"
  [ "${status}" -eq 0 ]
  [ -z "${output}" ]
}

@test "annotate.sh fails when results file is missing" {
  FUGAZI_RESULTS_FILE="/nonexistent/path.json" run bash "${ROOT}/scripts/annotate.sh"
  [ "${status}" -ne 0 ]
}
