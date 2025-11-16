#!/bin/bash

# Shopify Public App Deployment Script for Amazon Linux EC2
# Usage: ./deploy.sh

set -e

echo "🚀 Starting Shopify Public App deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo -e "${RED}Please do not run as root. Use a regular user with sudo privileges.${NC}"
   exit 1
fi

# Detect Amazon Linux version
if [ -f /etc/os-release ]; then
    . /etc/os-release
    AMAZON_LINUX_VERSION=$(echo $VERSION_ID | cut -d. -f1)
else
    AMAZON_LINUX_VERSION=2  # Default to AL2
fi

echo "Detected Amazon Linux version: $AMAZON_LINUX_VERSION"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating template...${NC}"
    cat > .env << 'EOF'
NODE_ENV=production
PORT=3000

SHOPIFY_API_KEY=your_shopify_api_key_here
SHOPIFY_API_SECRET=your_shopify_api_secret_here
SHOPIFY_APP_URL=https://store-app.peeq.co.in
SHOPIFY_SCOPES=read_products,write_products

MONGODB_URI=your_mongodb_connection_string_here
EOF
    echo -e "${YELLOW}⚠️  Please edit .env file with your actual credentials before continuing.${NC}"
    exit 1
fi

# Update system packages
echo "📦 Updating system packages..."
if [ "$AMAZON_LINUX_VERSION" = "2023" ]; then
    sudo dnf update -y
else
    sudo yum update -y
fi

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    if [ "$AMAZON_LINUX_VERSION" = "2023" ]; then
        sudo dnf install -y nodejs
    else
        sudo yum install -y nodejs
    fi
else
    echo -e "${GREEN}✓ Node.js already installed ($(node --version))${NC}"
fi

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
else
    echo -e "${GREEN}✓ PM2 already installed${NC}"
fi

# Install project dependencies
echo "📦 Installing project dependencies..."
npm install --production

# Create logs directory
mkdir -p logs

# Stop existing PM2 process if running
pm2 delete shopify-app 2>/dev/null || true

# Start the application with PM2 using ecosystem config
echo "🚀 Starting application with PM2..."
if [ -f ecosystem.config.js ]; then
    pm2 start ecosystem.config.js
else
    # Fallback if ecosystem.config.js doesn't exist
    pm2 start server.js --name shopify-app --output logs/out.log --error logs/error.log --log logs/combined.log
fi

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
echo "⚙️  Setting up PM2 startup script..."
STARTUP_CMD=$(pm2 startup systemd -u $USER --hp $HOME | grep "sudo")
if [ ! -z "$STARTUP_CMD" ]; then
    echo "Run this command to enable PM2 on boot:"
    echo -e "${YELLOW}$STARTUP_CMD${NC}"
fi

# Check if Nginx is installed
if ! command -v nginx &> /dev/null; then
    echo "📦 Installing Nginx..."
    if [ "$AMAZON_LINUX_VERSION" = "2023" ]; then
        # Amazon Linux 2023 uses dnf
        sudo dnf install -y nginx
    else
        # Amazon Linux 2 uses amazon-linux-extras or yum
        if command -v amazon-linux-extras &> /dev/null; then
            sudo amazon-linux-extras install -y nginx1
        else
            sudo yum install -y nginx
        fi
    fi
    sudo systemctl enable nginx
    sudo systemctl start nginx
else
    echo -e "${GREEN}✓ Nginx already installed${NC}"
fi

# Setup Nginx reverse proxy
echo "⚙️  Configuring Nginx..."
sudo tee /etc/nginx/conf.d/shopify.conf > /dev/null << 'EOF'
# HTTP server
server {
    listen 80;
    server_name store-app.peeq.co.in;

    # Allow Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Serve HTTP until SSL is configured
    # After running certbot, this will be changed to redirect to HTTPS
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts for long-running requests
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Increase body size limit for webhooks
    client_max_body_size 10M;
}

# HTTPS server - UNCOMMENT AFTER RUNNING CERTBOT
# Certbot will automatically configure this when you run: sudo certbot --nginx -d store-app.peeq.co.in
# 
# server {
#     listen 443 ssl;
#     http2 on;
#     server_name store-app.peeq.co.in;
#
#     ssl_certificate /etc/letsencrypt/live/store-app.peeq.co.in/fullchain.pem;
#     ssl_certificate_key /etc/letsencrypt/live/store-app.peeq.co.in/privkey.pem;
#     
#     ssl_protocols TLSv1.2 TLSv1.3;
#     ssl_ciphers HIGH:!aNULL:!MD5;
#     ssl_prefer_server_ciphers on;
#     ssl_session_cache shared:SSL:10m;
#     ssl_session_timeout 10m;
#
#     client_max_body_size 10M;
#
#     location / {
#         proxy_pass http://127.0.0.1:3000;
#         proxy_http_version 1.1;
#         proxy_set_header Upgrade $http_upgrade;
#         proxy_set_header Connection 'upgrade';
#         proxy_set_header Host $host;
#         proxy_set_header X-Real-IP $remote_addr;
#         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#         proxy_set_header X-Forwarded-Proto $scheme;
#         proxy_cache_bypass $http_upgrade;
#         
#         proxy_connect_timeout 60s;
#         proxy_send_timeout 60s;
#         proxy_read_timeout 60s;
#     }
# }
EOF

# Test Nginx configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

echo -e "${GREEN}✓ Deployment complete!${NC}"
echo ""
echo "📋 Next steps:"
echo "1. Ensure your DNS A record points store-app.peeq.co.in to this server's IP"
echo "2. Install SSL certificate: sudo certbot --nginx -d store-app.peeq.co.in"
echo "3. Update Shopify Partner Dashboard:"
echo "   - App URL: https://store-app.peeq.co.in"
echo "   - Allowed redirection URL: https://store-app.peeq.co.in/auth/callback"
echo "4. Test the app: https://store-app.peeq.co.in/health"
echo ""
echo "📊 PM2 Commands:"
echo "  pm2 status          - Check app status"
echo "  pm2 logs shopify-app - View logs"
echo "  pm2 restart shopify-app - Restart app"
echo "  pm2 stop shopify-app - Stop app"

