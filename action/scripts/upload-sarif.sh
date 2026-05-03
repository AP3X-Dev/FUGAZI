#!/usr/bin/env bash
#
# Generate the SARIF file for upload to GitHub Code Scanning. The action.yml
# wires the github/codeql-action/upload-sarif@v3 step to consume the result.
set -euo pipefail

OUT="fugazi.sarif"

fugazi audit --format sarif --output "${OUT}"

if [[ ! -s "${OUT}" ]]; then
  echo "fugazi-action: SARIF output is empty" >&2
  exit 1
fi

echo "fugazi-action: wrote ${OUT}"
