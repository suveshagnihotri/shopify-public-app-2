#!/bin/bash

# Quick Deployment Script for Shopify Public App
# Usage: ./quick-deploy.sh

set -e

echo "🚀 Quick Deployment - Shopify Public App"
echo ""

cd ~/shopify-public-app-2 || cd ~/shopify_public_app || { echo "❌ App directory not found"; exit 1; }

# Pull latest code (if using git)
if [ -d .git ]; then
    echo "📥 Pulling latest code..."
    git pull origin main || git pull || echo "⚠️  Git pull skipped"
else
    echo "ℹ️  Not a git repository, skipping pull"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Restart app
echo "🔄 Restarting application..."
pm2 restart shopify-app || pm2 start ecosystem.config.js

# Wait a moment
sleep 2

# Check status
echo ""
echo "📊 Application Status:"
pm2 status shopify-app

# Test health
echo ""
echo "🧪 Testing health endpoint..."
if curl -s -o /dev/null -w "%{http_code}" https://store-app.peeq.co.in/health | grep -q "200"; then
    echo "✅ Health check passed"
else
    echo "⚠️  Health check failed - check logs: pm2 logs shopify-app"
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Useful commands:"
echo "  pm2 logs shopify-app          - View logs"
echo "  pm2 status                    - Check status"
echo "  pm2 restart shopify-app        - Restart app"
echo "  curl https://store-app.peeq.co.in/health  - Test endpoint"

