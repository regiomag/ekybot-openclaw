#!/bin/bash
# Post-deploy script - logs activity, updates roadmap, notifies user
# Usage: ./scripts/post-deploy.sh "v0.5.0" "Description des changements" [task_id_to_update]

VERSION=$1
DESCRIPTION=$2
TASK_ID=$3
TOKEN="${AGENT_TOKEN}"
USER_EMAIL="user_39HokHR0AK7UDBWIEQKclgrcWh8@ekybot.temp"
CURRENT_TIME=$(date "+%H:%M")

# 1. Post activity log
echo "📝 Posting activity log..."
curl -s -X POST "https://www.ekybot.com/api/agent-log" \
  -H "Content-Type: application/json" \
  -H "x-agent-token: $TOKEN" \
  -d "{\"type\": \"deploy\", \"message\": \"$VERSION déployé - $DESCRIPTION\"}"

# 2. Update roadmap task if provided
if [ -n "$TASK_ID" ]; then
  echo "📋 Updating roadmap task to testing..."
  curl -s -X PATCH "https://www.ekybot.com/api/roadmap" \
    -H "Content-Type: application/json" \
    -H "x-agent-token: $TOKEN" \
    -d "{\"id\": \"$TASK_ID\", \"status\": \"testing\"}"
fi

# 3. Notify user
echo "📨 Notifying user..."
curl -s -X POST "https://www.ekybot.com/api/messages" \
  -H "Content-Type: application/json" \
  -H "x-agent-token: $TOKEN" \
  -d "{
    \"channelName\": \"general\",
    \"targetUserEmail\": \"$USER_EMAIL\",
    \"message\": {
      \"role\": \"assistant\",
      \"content\": \"🚀 **$VERSION déployé !** ($CURRENT_TIME)\\n\\n$DESCRIPTION\\n\\nHard refresh pour tester!\",
      \"timestamp\": $(date +%s)000
    }
  }"

echo "✅ Post-deploy complete!"
