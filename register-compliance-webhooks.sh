#!/bin/bash

# Register Compliance Webhooks via Shopify CLI
# Usage: ./register-compliance-webhooks.sh

set -e

echo "🚀 Registering Compliance Webhooks via Shopify CLI"
echo ""

# Check if Shopify CLI is installed
if ! command -v shopify &> /dev/null; then
    echo "❌ Shopify CLI not found"
    echo ""
    echo "Installing Shopify CLI..."
    echo ""
    echo "Choose installation method:"
    echo "  1. npm (recommended)"
    echo "  2. Homebrew (macOS)"
    echo ""
    read -p "Enter choice (1 or 2): " choice
    
    if [ "$choice" = "1" ]; then
        npm install -g @shopify/cli @shopify/theme
    elif [ "$choice" = "2" ]; then
        brew tap shopify/shopify
        brew install shopify-cli
    else
        echo "Invalid choice. Please install manually:"
        echo "  npm install -g @shopify/cli"
        exit 1
    fi
fi

echo "✅ Shopify CLI found"
echo ""

# Check if logged in
echo "📝 Checking authentication..."
if ! shopify whoami &> /dev/null; then
    echo "⚠️  Not logged in to Shopify CLI"
    echo ""
    echo "Please login:"
    shopify auth login
else
    echo "✅ Already logged in"
    shopify whoami
fi

echo ""
echo "📝 Checking shopify.app.toml..."
if [ ! -f "shopify.app.toml" ]; then
    echo "❌ shopify.app.toml not found"
    echo "   Please create it first (see REGISTER_COMPLIANCE_VIA_CODE.md)"
    exit 1
fi

echo "✅ shopify.app.toml found"
echo ""

# Check if client_id is set
if grep -q "YOUR_SHOPIFY_API_KEY" shopify.app.toml; then
    echo "⚠️  Warning: client_id in shopify.app.toml is not set"
    echo "   Please update shopify.app.toml with your API key from Partner Dashboard"
    echo ""
    read -p "Continue anyway? (y/n): " continue_anyway
    if [ "$continue_anyway" != "y" ]; then
        exit 1
    fi
fi

echo "📝 Registering compliance webhooks..."
echo ""

# Deploy/register webhooks
shopify app deploy

echo ""
echo "✅ Webhook registration complete!"
echo ""
echo "📋 Next steps:"
echo "  1. Verify in Partner Dashboard → Your App → App setup → Webhooks"
echo "  2. Test endpoint: curl -X POST https://store-app.peeq.co.in/webhooks"
echo "  3. All 3 compliance webhooks should show as 'Active'"

