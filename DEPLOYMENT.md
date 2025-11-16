# Deployment Guide

Production deployment guide for Shopify Public App on Amazon Linux EC2.

## Prerequisites

- Amazon Linux 2 EC2 instance
- Domain name `shopify.peeq.co.in` pointing to EC2 public IP
- MongoDB database (Atlas or self-hosted)
- Shopify Partner account with app credentials

## Quick Deployment

### Option 1: Automated Script (Recommended)

```bash
# Clone repository
git clone <your-repo-url> shopify_public_app
cd shopify_public_app

# Create .env file with your credentials
cp .env.example .env
nano .env  # Edit with your actual values

# Make deploy script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

### Option 2: Manual Deployment

#### 1. Install Dependencies

```bash
sudo yum update -y
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
sudo npm install -g pm2
```

#### 2. Setup Application

```bash
cd ~/shopify_public_app
npm install --production
```

#### 3. Configure Environment

Create `.env` file:

```env
NODE_ENV=production
PORT=3000

SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_APP_URL=https://shopify.peeq.co.in
SHOPIFY_SCOPES=read_products,write_products

MONGODB_URI=mongodb://your_connection_string
```

#### 4. Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd  # Follow instructions to enable on boot
```

#### 5. Setup Nginx

```bash
sudo amazon-linux-extras install -y nginx1
sudo cp shopify.conf /etc/nginx/conf.d/
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl start nginx
```

#### 6. Setup SSL (Let's Encrypt)

```bash
sudo yum install -y python3-certbot-nginx
sudo certbot --nginx -d shopify.peeq.co.in
```

## Configuration Files

### PM2 Ecosystem (`ecosystem.config.js`)

Manages process with PM2:

```bash
pm2 start ecosystem.config.js
pm2 status
pm2 logs shopify-app
pm2 restart shopify-app
```

### Systemd Service (`shopify-app.service`)

Alternative to PM2 using systemd:

```bash
# Copy service file
sudo cp shopify-app.service /etc/systemd/system/

# Edit path in service file if needed
sudo nano /etc/systemd/system/shopify-app.service

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable shopify-app
sudo systemctl start shopify-app

# Check status
sudo systemctl status shopify-app
sudo journalctl -u shopify-app -f
```

## Shopify Partner Dashboard Configuration

Update these settings in your Shopify Partner Dashboard:

1. **App URL**: `https://shopify.peeq.co.in`
2. **Allowed redirection URL(s)**: `https://shopify.peeq.co.in/auth/callback`
3. **Webhook URL** (if configured): `https://shopify.peeq.co.in/webhooks`

## Verification

1. **Health Check**: `https://shopify.peeq.co.in/health`
2. **OAuth Flow**: `https://shopify.peeq.co.in/auth?shop=YOUR_SHOP.myshopify.com`

## Monitoring

### PM2 Monitoring

```bash
pm2 monit
pm2 logs shopify-app --lines 100
```

### System Logs

```bash
# PM2 logs
tail -f logs/app.log

# Systemd logs (if using systemd)
sudo journalctl -u shopify-app -f
```

## Maintenance

### Update Application

```bash
cd ~/shopify_public_app
git pull
npm install --production
pm2 restart shopify-app
```

### View Logs

```bash
pm2 logs shopify-app
# or
tail -f logs/app.log logs/error.log
```

### Restart Application

```bash
pm2 restart shopify-app
# or
sudo systemctl restart shopify-app
```

## Troubleshooting

### App not starting

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs shopify-app --err

# Check environment variables
pm2 env shopify-app
```

### Nginx issues

```bash
# Test configuration
sudo nginx -t

# Check Nginx status
sudo systemctl status nginx

# View Nginx logs
sudo tail -f /var/log/nginx/error.log
```

### MongoDB connection issues

- Verify `MONGODB_URI` in `.env`
- Check MongoDB network access (firewall/security groups)
- Test connection: `mongosh "your_connection_string"`

### SSL certificate renewal

Certbot auto-renews, but you can test:

```bash
sudo certbot renew --dry-run
```

## Security Checklist

- [ ] `.env` file has correct permissions (600)
- [ ] MongoDB connection uses authentication
- [ ] Firewall rules configured (ports 80, 443, 22)
- [ ] SSL certificate installed and auto-renewing
- [ ] Regular security updates applied
- [ ] Access tokens stored securely in database

## Backup

### Database Backup

```bash
# MongoDB backup (if self-hosted)
mongodump --uri="your_mongodb_uri" --out=/backup/$(date +%Y%m%d)
```

### Application Backup

```bash
# Backup application directory
tar -czf shopify-app-backup-$(date +%Y%m%d).tar.gz ~/shopify_public_app
```

