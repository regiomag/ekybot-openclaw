#!/bin/bash
# Sync OpenClaw cron jobs to Ekybot routines
# Reads ~/.openclaw/cron/jobs.json and POSTs to /api/routines/sync

JOBS_FILE="$HOME/.openclaw/cron/jobs.json"
EKYBOT_URL="${EKYBOT_URL:-https://www.ekybot.com}"
AGENT_TOKEN="${AGENT_TOKEN:-${AGENT_TOKEN}}"

if [ ! -f "$JOBS_FILE" ]; then
  echo "❌ $JOBS_FILE not found"
  exit 1
fi

# Extract jobs array from the file
JOBS=$(cat "$JOBS_FILE" | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const jobs = (data.jobs || []).map(j => ({
    id: j.id,
    name: j.name,
    schedule: j.schedule,
    enabled: j.enabled !== false,
    payload: j.payload || {}
  }));
  console.log(JSON.stringify({ jobs }));
")

RESULT=$(curl -s -X POST "$EKYBOT_URL/api/routines/sync" \
  -H "Content-Type: application/json" \
  -H "x-agent-token: $AGENT_TOKEN" \
  -d "$JOBS")

echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (d.success) {
    console.log('✅ Synced: ' + d.synced + ' (' + d.created + ' new, ' + d.updated + ' updated) / ' + d.total + ' total');
  } else {
    console.log('❌ Error:', d.error || JSON.stringify(d));
  }
"
