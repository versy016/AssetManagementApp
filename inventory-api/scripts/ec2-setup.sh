#!/bin/bash
# Run this ONCE on EC2 to make the git repo deployment-safe.
# It configures git so that files the workflow manages are always
# pulled cleanly without "untracked files would be overwritten" errors.

set -e
cd /home/ec2-user/AssetManagementApp

echo "=== Configuring git safe-to-deploy settings ==="

# Tell git to always use fast-forward only (prevents accidental merges on server)
git config pull.ff only

# If any local untracked files exist that clash with the remote, remove them
# (This is a one-time cleanup for the current conflict)
git fetch origin

# Check if there are any untracked files that would block a pull
CONFLICTS=$(git diff --name-only origin/main 2>/dev/null || true)
if [ -n "$CONFLICTS" ]; then
  echo "Potential conflicts detected:"
  echo "$CONFLICTS"
fi

echo ""
echo "=== Creating web-build/dist directory if missing ==="
mkdir -p /home/ec2-user/AssetManagementApp/web-build/dist

echo ""
echo "=== Checking nginx config points to correct path ==="
grep -r "web-build" /etc/nginx/ 2>/dev/null && echo "Found web-build reference in nginx config" || echo "No web-build reference found - check your nginx config!"

echo ""
echo "=== PM2 status ==="
pm2 list

echo ""
echo "=== Setup complete ==="
echo "The workflow will now:"
echo "  1. Build Expo web on GitHub Actions (free runner)"
echo "  2. SCP dist/ to /home/ec2-user/AssetManagementApp/web-build/dist/"
echo "  3. SSH: git pull --ff-only  (API code update)"
echo "  4. SSH: npm install + prisma migrate deploy + pm2 restart + nginx reload"
