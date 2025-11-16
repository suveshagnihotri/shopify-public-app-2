# Troubleshooting Guide

## 410 Gone Response

### Issue
When testing the OAuth endpoint with `curl`, you may receive a `410 Gone` response:

```bash
curl --location 'http://localhost:3000/auth?shop=your-store.myshopify.com'
# Returns: HTTP/1.1 410 Gone
```

### Cause
The Shopify API library detects bot User-Agents (like curl's default User-Agent) and returns a `410 Gone` response as a security measure to prevent automated OAuth flows.

### Solution

#### Option 1: Use a Browser-Like User-Agent (Recommended for Testing)
```bash
curl --location \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  'http://localhost:3000/auth?shop=your-store.myshopify.com'
```

#### Option 2: Test in a Browser
The OAuth flow is designed to work in browsers. Open the URL directly in your browser:
```
http://localhost:3000/auth?shop=your-store.myshopify.com
```

#### Option 3: Use Postman with Browser User-Agent
1. Open Postman
2. Create a GET request to `/auth?shop=your-store.myshopify.com`
3. Add a header: `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36`
4. Enable "Follow redirects" in Postman settings

### Why This Happens
Shopify's OAuth flow includes bot detection to prevent:
- Automated OAuth attacks
- Scraping of OAuth endpoints
- Unauthorized access attempts

The detection is based on the User-Agent header. Tools like `curl` have User-Agents that are flagged as bots.

### Testing OAuth Flow

1. **Start OAuth in Browser:**
   ```
   http://localhost:3000/auth?shop=your-store.myshopify.com
   ```

2. **Approve Installation:**
   - You'll be redirected to Shopify
   - Click "Install" to approve
   - Shopify redirects back to your callback URL

3. **Verify Session:**
   ```bash
   curl -b cookies.txt http://localhost:3000/
   ```

### Other Common Issues

#### MongoDB Connection Errors
- Ensure MongoDB is running: `mongod` or check MongoDB Atlas connection
- Verify `MONGODB_URI` in `.env` file
- Check MongoDB logs for connection issues

#### OAuth Callback Errors

##### "Could not find OAuth cookie" Error

This error occurs when the OAuth state cookie cannot be found during the callback. Common causes:

1. **HTTPS Required**: OAuth cookies require HTTPS. Ensure:
   - `SHOPIFY_APP_URL` in `.env` uses `https://` (not `http://`)
   - If using ngrok, use the HTTPS URL: `https://abc123.ngrok-free.app`
   - Never use `http://localhost` for OAuth flows

2. **Domain Mismatch**: The cookie domain must match exactly:
   - Cookie is set on the domain from `SHOPIFY_APP_URL`
   - Callback URL must be on the same domain
   - Update `SHOPIFY_APP_URL` in `.env` to match your actual app URL

3. **Cookie Expiration**: OAuth state cookies expire after 60 seconds:
   - Complete the OAuth flow quickly
   - Don't leave the Shopify approval page open too long
   - Try the flow again if it times out

4. **Browser Cookie Settings**:
   - Ensure cookies are enabled in your browser
   - Check if third-party cookies are blocked
   - Try in an incognito/private window

**Fix Steps:**
1. Check your `.env` file:
   ```bash
   SHOPIFY_APP_URL=https://your-ngrok-url.ngrok-free.app
   ```
   (Must use HTTPS, not HTTP)

2. Restart your server after updating `.env`

3. Clear browser cookies and try again

4. Verify the callback URL in Shopify Partner Dashboard matches your `SHOPIFY_APP_URL`

##### Other OAuth Issues
- Verify `SHOPIFY_APP_URL` in `.env` matches your app URL exactly
- Ensure callback URL is registered in Shopify Partner Dashboard
- Check that API key and secret are correct
- Ensure the callback URL uses HTTPS (required for OAuth cookies)

#### Session Not Found
- Sessions are stored in MongoDB
- Check MongoDB for session documents
- Verify session cookies are being set correctly

