#!/bin/bash

# Quick Fix Script for SSL Certificate Domain Mismatch
# Run this on your EC2 server to fix the certificate issue

set -e

echo "🔧 Fixing SSL Certificate Domain Mismatch..."
echo ""

# Step 1: Check existing certificates
echo "📋 Checking existing certificates..."
sudo certbot certificates

echo ""
read -p "Do you want to delete the old certificate? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Delete old certificate
    echo "🗑️  Deleting old certificate..."
    sudo certbot delete --cert-name shopify.peeq.co.in 2>/dev/null || {
        echo "⚠️  Certificate 'shopify.peeq.co.in' not found, checking for other certificates..."
        CERT_NAME=$(sudo certbot certificates | grep "Certificate Name" | head -1 | awk '{print $3}')
        if [ ! -z "$CERT_NAME" ]; then
            echo "Found certificate: $CERT_NAME"
            read -p "Delete this certificate? (y/n) " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                sudo certbot delete --cert-name "$CERT_NAME"
            fi
        fi
    }
    
    # Clean up old files
    echo "🧹 Cleaning up old certificate files..."
    sudo rm -rf /etc/letsencrypt/live/shopify.peeq.co.in
    sudo rm -rf /etc/letsencrypt/archive/shopify.peeq.co.in
    sudo rm -rf /etc/letsencrypt/renewal/shopify.peeq.co.in.conf
fi

# Step 2: Verify DNS
echo ""
echo "🌐 Verifying DNS..."
DNS_IP=$(dig +short store-app.peeq.co.in | tail -1)
EC2_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)

echo "DNS resolves to: $DNS_IP"
echo "EC2 public IP: $EC2_IP"

if [ "$DNS_IP" != "$EC2_IP" ]; then
    echo "⚠️  WARNING: DNS doesn't match EC2 IP!"
    echo "   Please update your DNS A record: store-app.peeq.co.in → $EC2_IP"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Step 3: Temporarily update Nginx to allow HTTP
echo ""
echo "⚙️  Updating Nginx configuration (temporarily allow HTTP)..."
sudo tee /etc/nginx/conf.d/shopify.conf > /dev/null << 'EOF'
server {
    listen 80;
    server_name store-app.peeq.co.in;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Temporarily serve HTTP for certbot verification
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Test and reload Nginx
echo "Testing Nginx configuration..."
sudo nginx -t
echo "Reloading Nginx..."
sudo systemctl reload nginx

# Step 4: Get new certificate
echo ""
echo "🔐 Obtaining new SSL certificate for store-app.peeq.co.in..."
echo ""

# Check if email is provided
if [ -z "$CERTBOT_EMAIL" ]; then
    read -p "Enter email for certificate renewal notices: " CERTBOT_EMAIL
fi

sudo certbot --nginx -d store-app.peeq.co.in \
    --non-interactive \
    --agree-tos \
    --email "$CERTBOT_EMAIL" \
    --redirect

# Step 5: Verify
echo ""
echo "✅ Certificate installation complete!"
echo ""
echo "📋 Certificate details:"
sudo certbot certificates

echo ""
echo "🧪 Testing HTTPS..."
curl -I https://store-app.peeq.co.in/health 2>&1 | head -5

echo ""
echo "✅ Done! Your SSL certificate should now work correctly."
echo "   Visit: https://store-app.peeq.co.in/health"

