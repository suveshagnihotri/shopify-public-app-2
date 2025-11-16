#!/bin/bash

# SSL Certificate Setup Script for Shopify Public App
# Usage: ./setup-ssl.sh

set -e

DOMAIN="store-app.peeq.co.in"

echo "🔒 Setting up SSL certificate for $DOMAIN..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
   echo "Please run with sudo: sudo ./setup-ssl.sh"
   exit 1
fi

# Detect Amazon Linux version
if [ -f /etc/os-release ]; then
    . /etc/os-release
    AMAZON_LINUX_VERSION=$(echo $VERSION_ID | cut -d. -f1)
else
    AMAZON_LINUX_VERSION=2
fi

# Install certbot
echo "📦 Installing certbot..."
if [ "$AMAZON_LINUX_VERSION" = "2023" ]; then
    dnf install -y python3-certbot-nginx
else
    yum install -y python3-certbot-nginx
fi

# Create directory for Let's Encrypt challenges
mkdir -p /var/www/certbot

# Run certbot to get certificate
echo "🔐 Obtaining SSL certificate from Let's Encrypt..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@peeq.co.in --redirect

# Test certificate renewal
echo "🧪 Testing certificate renewal..."
certbot renew --dry-run

echo "✅ SSL certificate setup complete!"
echo ""
echo "Your site should now be accessible at: https://$DOMAIN"
echo ""
echo "Certificate will auto-renew. Check renewal with: sudo certbot renew --dry-run"

