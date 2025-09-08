#!/bin/bash

# Deployment script for Asset Management App
# Usage: ./deploy.sh [environment]
# Example: ./deploy.sh production

set -e  # Exit immediately if a command exits with a non-zero status

echo "🚀 Starting deployment..."

# Default environment is production
ENVIRONMENT=${1:-production}
APP_NAME="asset-management-app"
API_DIR="inventory-api"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
  echo "❌ Error: Invalid environment '$ENVIRONMENT'. Must be one of: development, staging, production"
  exit 1
fi

echo "🌍 Environment: $ENVIRONMENT"

# Install dependencies
echo "📦 Installing dependencies..."
npm ci
cd $API_DIR
npm ci
cd ..

# Build the application
echo "🔨 Building application..."
npm run build

# Set environment variables
export NODE_ENV=$ENVIRONMENT

# Run database migrations
echo "🔄 Running database migrations..."
cd $API_DIR
npx prisma migrate deploy
cd ..

# Restart PM2 processes
echo "🔄 Restarting services..."
if pm2 list | grep -q $APP_NAME; then
  pm2 restart $APP_NAME --update-env
else
  pm2 start npm --name $APP_NAME -- start
  pm2 save
fi

# Show deployment status
echo "✅ Deployment complete!"
pm2 list | grep $APP_NAME

# Display logs
echo "📝 Tailing logs..."
pm2 logs $APP_NAME --lines 10

echo "✨ Deployment to $ENVIRONMENT completed successfully!"
