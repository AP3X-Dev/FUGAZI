#!/usr/bin/env bats
#
# Bats tests for analyse.sh. We stub the fugazi binary so it writes a
# canned JSON, then assert that the script produces both the Code Climate
# JSON and the JSON copy.

setup() {
  HERE="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
  ROOT="${HERE}/.."
  WORK="$(mktemp -d)"
  STUB="$(mktemp -d)"
  cat >"${STUB}/fugazi" <<EOF
#!/usr/bin/env bash
# Crude stub: emits an empty results JSON to whatever --output points at.
out=""
while [[ \$# -gt 0 ]]; do
  if [[ "\$1" == "--output" ]]; then
    out="\$2"; shift 2
  else
    shift
  fi
done
[ -n "\${out}" ] && printf '{"issues":[],"duplicates":[]}' > "\${out}"
EOF
  chmod +x "${STUB}/fugazi"
  export PATH="${STUB}:${PATH}"
  cd "${WORK}"
}

@test "analyse.sh writes both Code Climate and JSON outputs" {
  FUGAZI_FAIL_ON_ISSUES="true" run bash "${ROOT}/scripts/analyse.sh"
  [ "${status}" -eq 0 ]
  [ -f "gl-code-quality-report.json" ]
  [ -f "fugazi-results.json" ]
}

@test "analyse.sh exits zero on empty findings" {
  FUGAZI_FAIL_ON_ISSUES="true" run bash "${ROOT}/scripts/analyse.sh"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"0 issue(s) reported"* ]]
}
