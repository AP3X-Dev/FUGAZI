#!/usr/bin/env bash
#
# Post or update a sticky PR comment with the Markdown summary.
#
# Sticky algorithm:
#   1. List comments on the PR.
#   2. Look for one whose body starts with the marker `<!-- fugazi:pr-summary -->`.
#   3. If found, PATCH it; else POST a new comment.
set -euo pipefail

RESULTS="${FUGAZI_RESULTS_FILE:-fugazi-results.json}"
REPO="${GH_REPO:?GH_REPO is required}"
PR="${GH_PR_NUMBER:?GH_PR_NUMBER is required}"
TOKEN="${GH_TOKEN:?GH_TOKEN is required}"

if ! command -v jq >/dev/null 2>&1; then
  echo "fugazi-action: jq is required for pr-comment; skipping" >&2
  exit 0
fi

MARKER="<!-- fugazi:pr-summary -->"
HERE="$(cd "$(dirname "$0")" && pwd)"

BODY=$(jq -rf "${HERE}/../jq/review-body.jq" "${RESULTS}")
PAYLOAD=$(jq -n --arg body "${MARKER}
${BODY}" '{ body: $body }')

# Try gh first; fall back to curl if gh isn't installed.
if command -v gh >/dev/null 2>&1; then
  EXISTING=$(gh api "repos/${REPO}/issues/${PR}/comments" \
    --jq "[.[] | select(.body | startswith(\"${MARKER}\"))][0].id" || true)
  if [[ -n "${EXISTING}" && "${EXISTING}" != "null" ]]; then
    echo "${PAYLOAD}" | gh api --method PATCH "repos/${REPO}/issues/comments/${EXISTING}" --input -
  else
    echo "${PAYLOAD}" | gh api --method POST "repos/${REPO}/issues/${PR}/comments" --input -
  fi
else
  AUTH="Authorization: Bearer ${TOKEN}"
  ACCEPT="Accept: application/vnd.github+json"
  EXISTING=$(curl -fsSL -H "${AUTH}" -H "${ACCEPT}" \
    "https://api.github.com/repos/${REPO}/issues/${PR}/comments" \
    | jq -r --arg m "${MARKER}" '[.[] | select(.body | startswith($m))][0].id // empty')
  if [[ -n "${EXISTING}" ]]; then
    curl -fsSL -X PATCH -H "${AUTH}" -H "${ACCEPT}" \
      -d "${PAYLOAD}" \
      "https://api.github.com/repos/${REPO}/issues/comments/${EXISTING}"
  else
    curl -fsSL -X POST -H "${AUTH}" -H "${ACCEPT}" \
      -d "${PAYLOAD}" \
      "https://api.github.com/repos/${REPO}/issues/${PR}/comments"
  fi
fi
