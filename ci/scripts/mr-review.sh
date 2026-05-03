#!/usr/bin/env bash
#
# Post inline MR discussion notes via the GitLab API.
# Required predefined variables: CI_API_V4_URL, CI_PROJECT_ID, CI_MERGE_REQUEST_IID, CI_PROJECT_URL.
# Required token: CI_JOB_TOKEN (read-only) is not enough for discussions; the
# pipeline must inject FUGAZI_GITLAB_TOKEN with api scope.
set -euo pipefail

JSON="${FUGAZI_RESULTS_FILE:-fugazi-results.json}"
TOKEN="${FUGAZI_GITLAB_TOKEN:-}"
API="${CI_API_V4_URL:?CI_API_V4_URL is required}"
PROJECT="${CI_PROJECT_ID:?CI_PROJECT_ID is required}"
MR_IID="${CI_MERGE_REQUEST_IID:?CI_MERGE_REQUEST_IID is required}"

if [[ -z "${TOKEN}" ]]; then
  echo "fugazi-ci: FUGAZI_GITLAB_TOKEN not set; skipping MR review" >&2
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "fugazi-ci: jq is required for mr-review; skipping" >&2
  exit 0
fi

HERE="$(cd "$(dirname "$0")" && pwd)"

CHECK=$(jq -cf "${HERE}/../jq/review-comments-check.jq" "${JSON}")
DUPES=$(jq -cf "${HERE}/../jq/review-comments-dupes.jq" "${JSON}")
HEALTH=$(jq -cf "${HERE}/../jq/review-comments-health.jq" "${JSON}")

ALL=$(jq -n \
  --argjson check "${CHECK}" \
  --argjson dupes "${DUPES}" \
  --argjson health "${HEALTH}" \
  '$check + $dupes + $health')

# Post a single MR note with the rendered Markdown body.
BODY=$(jq -rf "${HERE}/../jq/review-body.jq" "${JSON}")
NOTE_PAYLOAD=$(jq -n --arg body "${BODY}" '{ body: $body }')

curl -fsSL -X POST \
  -H "PRIVATE-TOKEN: ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${NOTE_PAYLOAD}" \
  "${API}/projects/${PROJECT}/merge_requests/${MR_IID}/notes"

# Then post each inline finding as a per-line discussion.
echo "${ALL}" | jq -c '.[]' | while IFS= read -r LINE; do
  curl -fsSL -X POST \
    -H "PRIVATE-TOKEN: ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${LINE}" \
    "${API}/projects/${PROJECT}/merge_requests/${MR_IID}/discussions" || true
done
