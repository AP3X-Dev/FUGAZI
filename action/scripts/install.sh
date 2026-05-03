#!/usr/bin/env bash
#
# Install the fugazi CLI.
#
# Strategy: prefer Bun if BUN_VERSION env is set (faster install); otherwise
# fall back to npm global install. The CI runner must already have Node 18+
# available; this script does NOT bootstrap Node.
set -euo pipefail

VERSION="${FUGAZI_VERSION:-latest}"

if [[ -n "${BUN_VERSION:-}" ]] && command -v bun >/dev/null 2>&1; then
  echo "fugazi-action: installing fugazi@${VERSION} via Bun"
  bun add -g "fugazi@${VERSION}"
else
  if ! command -v npm >/dev/null 2>&1; then
    echo "fugazi-action: npm not on PATH; install Node 18+ before this action" >&2
    exit 1
  fi
  echo "fugazi-action: installing fugazi@${VERSION} via npm"
  npm install -g "fugazi@${VERSION}"
fi

if ! command -v fugazi >/dev/null 2>&1; then
  echo "fugazi-action: fugazi binary not on PATH after install" >&2
  exit 1
fi

fugazi --version || true
