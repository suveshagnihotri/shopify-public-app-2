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

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating template...${NC}"
    cat > .env << 'EOF'
NODE_ENV=production
PORT=3000

SHOPIFY_API_KEY=your_shopify_api_key_here
SHOPIFY_API_SECRET=your_shopify_api_secret_here
SHOPIFY_APP_URL=https://shopify.peeq.co.in
SHOPIFY_SCOPES=read_products,write_products

MONGODB_URI=your_mongodb_connection_string_here
EOF
    echo -e "${YELLOW}⚠️  Please edit .env file with your actual credentials before continuing.${NC}"
    exit 1
fi

# Update system packages
echo "📦 Updating system packages..."
sudo yum update -y

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    sudo yum install -y nodejs
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

# Start the application with PM2
echo "🚀 Starting application with PM2..."
pm2 start server.js --name shopify-app --log logs/app.log --error logs/error.log --out logs/out.log

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
    sudo amazon-linux-extras install -y nginx1
    sudo systemctl enable nginx
    sudo systemctl start nginx
else
    echo -e "${GREEN}✓ Nginx already installed${NC}"
fi

# Setup Nginx reverse proxy
echo "⚙️  Configuring Nginx..."
sudo tee /etc/nginx/conf.d/shopify.conf > /dev/null << 'EOF'
server {
    listen 80;
    server_name shopify.peeq.co.in;

    # Increase body size limit for webhooks
    client_max_body_size 10M;

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
}
EOF

# Test Nginx configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

echo -e "${GREEN}✓ Deployment complete!${NC}"
echo ""
echo "📋 Next steps:"
echo "1. Ensure your DNS A record points shopify.peeq.co.in to this server's IP"
echo "2. Install SSL certificate: sudo certbot --nginx -d shopify.peeq.co.in"
echo "3. Update Shopify Partner Dashboard:"
echo "   - App URL: https://shopify.peeq.co.in"
echo "   - Allowed redirection URL: https://shopify.peeq.co.in/auth/callback"
echo "4. Test the app: https://shopify.peeq.co.in/health"
echo ""
echo "📊 PM2 Commands:"
echo "  pm2 status          - Check app status"
echo "  pm2 logs shopify-app - View logs"
echo "  pm2 restart shopify-app - Restart app"
echo "  pm2 stop shopify-app - Stop app"

