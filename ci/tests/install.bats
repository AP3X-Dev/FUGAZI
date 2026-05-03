#!/usr/bin/env bats
#
# Bats tests for the install.sh script. We mock npm + node by injecting
# stub commands on PATH so the script can complete without network access.

setup() {
  HERE="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
  ROOT="${HERE}/.."
  STUB="$(mktemp -d)"
  cat >"${STUB}/node" <<'EOF'
#!/usr/bin/env bash
echo "v22.0.0"
EOF
  cat >"${STUB}/npm" <<'EOF'
#!/usr/bin/env bash
echo "fugazi-ci-test: npm install received: $*"
EOF
  cat >"${STUB}/fugazi" <<'EOF'
#!/usr/bin/env bash
echo "fugazi 0.1.0-rc.1"
EOF
  chmod +x "${STUB}/node" "${STUB}/npm" "${STUB}/fugazi"
  export PATH="${STUB}:${PATH}"
}

@test "install.sh succeeds when node + npm are available" {
  FUGAZI_VERSION="0.1.0-rc.1" run bash "${ROOT}/scripts/install.sh"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"installing fugazi@0.1.0-rc.1 via npm"* ]]
  [[ "${output}" == *"fugazi 0.1.0-rc.1"* ]]
}

@test "install.sh defaults to FUGAZI_VERSION=latest" {
  unset FUGAZI_VERSION
  run bash "${ROOT}/scripts/install.sh"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"fugazi@latest"* ]]
}
