#!/bin/bash

# Script to deploy with automatic version increment
# Usage: ./scripts/deploy-with-version.sh "Description of changes"

# Check if description is provided
if [ -z "$1" ]; then
    echo "Error: Please provide a description of changes"
    echo "Usage: ./scripts/deploy-with-version.sh \"Description of changes\""
    exit 1
fi

DESCRIPTION="$1"
VERSION_FILE="apps/web/src/config/version.ts"

# Extract current version (supports single or double quotes)
CURRENT_VERSION=$(grep "APP_VERSION" "$VERSION_FILE" | sed -E "s/.*['\"]v([^'\"]*)['\"].*/\1/" 2>/dev/null || echo "0.15.35")

# Increment by 0.01 (e.g., 0.8.41 -> 0.8.42)
# Handle both formats: 0.8.4 and 0.8.41
if [[ "$CURRENT_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    MAJOR="${BASH_REMATCH[1]}"
    MINOR="${BASH_REMATCH[2]}"
    PATCH="${BASH_REMATCH[3]}"
    
    # If patch is single digit, convert to two digits (4 -> 41)
    if [ ${#PATCH} -eq 1 ]; then
        NEW_PATCH="${PATCH}1"
    else
        # Increment last digit
        NEW_PATCH=$((PATCH + 1))
    fi
    NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"
else
    echo "Error: Cannot parse version $CURRENT_VERSION"
    exit 1
fi

echo "📦 Updating version from v$CURRENT_VERSION to v$NEW_VERSION"

# Update version file (macOS compatible, preserves single-quote style currently used)
sed -i '' "s/APP_VERSION = 'v$CURRENT_VERSION'/APP_VERSION = 'v$NEW_VERSION'/" "$VERSION_FILE"

# Commit changes
git add -A
git commit -m "chore: bump version to v$NEW_VERSION

$DESCRIPTION"

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push

# Deploy to Vercel with race condition protection
echo "🚀 Deploying to Vercel..."

# Check if another deployment is running
echo "🔍 Checking for concurrent deployments..."
RUNNING_DEPLOYMENTS=$(vercel list | grep -E "(Building|Queued)" | wc -l)
if [ "$RUNNING_DEPLOYMENTS" -gt 0 ]; then
    echo "⏳ Waiting for $RUNNING_DEPLOYMENTS running deployments to complete..."
    sleep 30
    # Re-check after wait
    RUNNING_DEPLOYMENTS=$(vercel list | grep -E "(Building|Queued)" | wc -l)
    if [ "$RUNNING_DEPLOYMENTS" -gt 0 ]; then
        echo "❌ Other deployments still running. Aborting to avoid race condition."
        echo "Please wait and retry in 1-2 minutes."
        exit 1
    fi
fi

# Rate limiting: ensure minimum 30s between deployments
LAST_DEPLOY_FILE=".last-deploy"
if [ -f "$LAST_DEPLOY_FILE" ]; then
    LAST_DEPLOY=$(cat "$LAST_DEPLOY_FILE")
    CURRENT_TIME=$(date +%s)
    TIME_DIFF=$((CURRENT_TIME - LAST_DEPLOY))
    if [ "$TIME_DIFF" -lt 30 ]; then
        WAIT_TIME=$((30 - TIME_DIFF))
        echo "⏳ Rate limiting: waiting ${WAIT_TIME}s before deployment..."
        sleep $WAIT_TIME
    fi
fi

echo "▶️ Starting deployment..."
vercel --prod --yes

# Record deployment time
echo $(date +%s) > "$LAST_DEPLOY_FILE"

# Verify deployment success
echo "🔍 Verifying deployment..."
sleep 10
LATEST_DEPLOYMENT=$(vercel list | head -n 2 | tail -n 1 | grep -E "(Ready|Error)")
if echo "$LATEST_DEPLOYMENT" | grep -q "Ready"; then
    echo "✅ Deployment verified successful"
else
    echo "❌ Deployment may have failed - check Vercel dashboard"
fi

# Post deployment notification
echo "📢 Posting notification..."
TIMESTAMP=$(date +%s000)
CURRENT_TIME=$(date "+%H:%M")

# Create JSON payload
JSON_PAYLOAD=$(cat <<EOF
{
  "channelName": "EkyBot-dev",
  "targetUserId": "${ADMIN_USER_ID}",
  "message": {
    "role": "assistant",
    "content": "🚀 **v$NEW_VERSION déployé !** ($CURRENT_TIME)\\n\\n$DESCRIPTION\\n\\n**Hard refresh recommandé** (Ctrl+Shift+R)",
    "timestamp": $TIMESTAMP,
    "authorName": "EkyBot-OPUS4"
  }
}
EOF
)

curl -X POST "https://www.ekybot.com/api/messages" \
  -H "Content-Type: application/json" \
  -H "x-agent-token: ${AGENT_TOKEN}" \
  -d "$JSON_PAYLOAD"

echo "✅ Deployment complete! Version v$NEW_VERSION is live."
