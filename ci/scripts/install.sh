#!/usr/bin/env bash
#
# Install fugazi inside a GitLab CI runner. Mirrors action/scripts/install.sh
# with an apt-get fallback for environments where Node is not preinstalled.
set -euo pipefail

VERSION="${FUGAZI_VERSION:-latest}"

if ! command -v node >/dev/null 2>&1; then
  echo "fugazi-ci: Node not found, attempting apt-get install"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y curl ca-certificates
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    echo "fugazi-ci: cannot bootstrap Node (no apt-get); use a node-based image" >&2
    exit 1
  fi
fi

if [[ -n "${BUN_VERSION:-}" ]] && command -v bun >/dev/null 2>&1; then
  echo "fugazi-ci: installing fugazi@${VERSION} via Bun"
  bun add -g "fugazi@${VERSION}"
else
  echo "fugazi-ci: installing fugazi@${VERSION} via npm"
  npm install -g "fugazi@${VERSION}"
fi

if ! command -v fugazi >/dev/null 2>&1; then
  echo "fugazi-ci: fugazi binary not on PATH after install" >&2
  exit 1
fi

fugazi --version || true
