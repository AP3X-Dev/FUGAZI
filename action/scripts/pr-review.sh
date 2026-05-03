#!/usr/bin/env bash
#
# Post inline review comments on a PR via the Reviews API.
# Each fugazi finding becomes one inline comment anchored to the file/line.
set -euo pipefail

RESULTS="${FUGAZI_RESULTS_FILE:-fugazi-results.json}"
REPO="${GH_REPO:?GH_REPO is required}"
PR="${GH_PR_NUMBER:?GH_PR_NUMBER is required}"
TOKEN="${GH_TOKEN:?GH_TOKEN is required}"
HEAD_SHA="${GH_PR_HEAD_SHA:-}"

if ! command -v jq >/dev/null 2>&1; then
  echo "fugazi-action: jq is required for pr-review; skipping" >&2
  exit 0
fi

HERE="$(cd "$(dirname "$0")" && pwd)"

CHECK_COMMENTS=$(jq -cf "${HERE}/../jq/review-comments-check.jq" "${RESULTS}")
HEALTH_COMMENTS=$(jq -cf "${HERE}/../jq/review-comments-health.jq" "${RESULTS}")

ALL_COMMENTS=$(jq -n \
  --argjson check "${CHECK_COMMENTS}" \
  --argjson health "${HEALTH_COMMENTS}" \
  '$check + $health')

REVIEW_BODY=$(jq -rf "${HERE}/../jq/review-body.jq" "${RESULTS}")

EVENT="COMMENT"

PAYLOAD=$(jq -n \
  --arg body "${REVIEW_BODY}" \
  --arg sha "${HEAD_SHA}" \
  --arg event "${EVENT}" \
  --argjson comments "${ALL_COMMENTS}" \
  '{
    body: $body,
    event: $event,
    commit_id: ($sha | select(length > 0)),
    comments: $comments
  } | with_entries(select(.value != null))')

if command -v gh >/dev/null 2>&1; then
  echo "${PAYLOAD}" | gh api --method POST "repos/${REPO}/pulls/${PR}/reviews" --input -
else
  curl -fsSL -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -d "${PAYLOAD}" \
    "https://api.github.com/repos/${REPO}/pulls/${PR}/reviews"
fi
