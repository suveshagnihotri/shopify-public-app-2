#!/bin/bash

# Server Diagnostic Script
# Run this on your EC2 server to diagnose connection issues

echo "🔍 Diagnosing Server Issues..."
echo ""

# 1. Check if app is running
echo "1️⃣  Checking PM2 Status:"
pm2 status shopify-app || echo "❌ App not running with PM2"
echo ""

# 2. Check if app responds on localhost
echo "2️⃣  Testing Local App (port 3000):"
if curl -s http://localhost:3000/health > /dev/null; then
    echo "✅ App is running on localhost:3000"
    curl -s http://localhost:3000/health | head -1
else
    echo "❌ App not responding on localhost:3000"
    echo "   Check: pm2 logs shopify-app"
fi
echo ""

# 3. Check Nginx status
echo "3️⃣  Checking Nginx:"
if sudo systemctl is-active --quiet nginx; then
    echo "✅ Nginx is running"
else
    echo "❌ Nginx is NOT running"
    echo "   Fix: sudo systemctl start nginx"
fi
echo ""

# 4. Check Nginx configuration
echo "4️⃣  Testing Nginx Configuration:"
if sudo nginx -t 2>&1 | grep -q "successful"; then
    echo "✅ Nginx configuration is valid"
else
    echo "❌ Nginx configuration has errors:"
    sudo nginx -t
fi
echo ""

# 5. Check if ports are listening
echo "5️⃣  Checking Ports:"
if sudo netstat -tlnp 2>/dev/null | grep -q ":3000"; then
    echo "✅ Port 3000 is listening (app)"
else
    echo "❌ Port 3000 is NOT listening"
fi

if sudo netstat -tlnp 2>/dev/null | grep -q ":443"; then
    echo "✅ Port 443 is listening (HTTPS)"
else
    echo "❌ Port 443 is NOT listening"
    echo "   This is why HTTPS connection fails!"
fi

if sudo netstat -tlnp 2>/dev/null | grep -q ":80"; then
    echo "✅ Port 80 is listening (HTTP)"
else
    echo "⚠️  Port 80 is NOT listening"
fi
echo ""

# 6. Check SSL certificate
echo "6️⃣  Checking SSL Certificate:"
if sudo certbot certificates 2>/dev/null | grep -q "store-app.peeq.co.in"; then
    echo "✅ SSL certificate exists for store-app.peeq.co.in"
    sudo certbot certificates | grep -A 5 "store-app.peeq.co.in"
else
    echo "❌ SSL certificate NOT found for store-app.peeq.co.in"
    echo "   Fix: sudo certbot --nginx -d store-app.peeq.co.in"
fi
echo ""

# 7. Check Nginx config for HTTPS
echo "7️⃣  Checking Nginx HTTPS Configuration:"
if sudo grep -q "listen 443" /etc/nginx/conf.d/shopify.conf 2>/dev/null; then
    echo "✅ HTTPS server block found in Nginx config"
else
    echo "❌ HTTPS server block NOT found"
    echo "   Need to add HTTPS configuration"
fi
echo ""

# 8. Check DNS
echo "8️⃣  Checking DNS:"
DNS_IP=$(dig +short store-app.peeq.co.in | tail -1)
EC2_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "unknown")
echo "   DNS resolves to: $DNS_IP"
echo "   EC2 public IP: $EC2_IP"
if [ "$DNS_IP" = "$EC2_IP" ]; then
    echo "✅ DNS is correct"
else
    echo "⚠️  DNS might not match EC2 IP"
fi
echo ""

# 9. Check recent errors
echo "9️⃣  Recent App Errors:"
pm2 logs shopify-app --lines 5 --nostream --err 2>/dev/null | tail -5 || echo "   No recent errors"
echo ""

echo "📋 Summary & Next Steps:"
echo ""
echo "If port 443 is NOT listening:"
echo "  1. Check Nginx is running: sudo systemctl start nginx"
echo "  2. Check SSL certificate: sudo certbot certificates"
echo "  3. Configure HTTPS: sudo certbot --nginx -d store-app.peeq.co.in"
echo ""
echo "If app is NOT running:"
echo "  1. Check logs: pm2 logs shopify-app"
echo "  2. Restart: pm2 restart shopify-app"
echo "  3. Check .env file exists and has correct values"
echo ""

