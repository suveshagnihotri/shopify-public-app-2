# Fixing OAuth Cookie Issue with ngrok

## Problem
The `shopify_app_state` cookie is not being received during the OAuth callback, causing "Could not find OAuth cookie" error.

## Root Cause
The ngrok interstitial page (`abuse_interstitial` cookie) can interfere with cookie persistence. When ngrok shows its interstitial page, it may clear or block cookies set during the initial OAuth request.

## Solutions

### Solution 1: Bypass ngrok Interstitial (Recommended)

Add ngrok's bypass header to your requests. Update your `.env`:

```bash
# Add this to bypass ngrok interstitial
NGROK_SKIP_BROWSER_WARNING=true
```

Or use ngrok's paid plan which doesn't show the interstitial.

### Solution 2: Use ngrok with Custom Domain

1. Sign up for ngrok account (free tier works)
2. Get a static domain: `ngrok config add-authtoken YOUR_TOKEN`
3. Use the static domain in your `.env`:
   ```bash
   SHOPIFY_APP_URL=https://your-static-domain.ngrok.io
   ```

### Solution 3: Use ngrok's Request Header

When testing in browser, you can bypass the interstitial by:
1. Opening ngrok URL in browser
2. Clicking "Visit Site" on the interstitial
3. This sets a cookie that bypasses future interstitials

### Solution 4: Use LocalTunnel or Cloudflare Tunnel

Alternative tunneling solutions that don't have interstitial pages:

**LocalTunnel:**
```bash
npm install -g localtunnel
lt --port 3000
```

**Cloudflare Tunnel:**
```bash
cloudflared tunnel --url http://localhost:3000
```

## Debugging Steps

1. **Check if cookie is being set:**
   - Look at server logs when `/auth` is called
   - Check for `Set-Cookie` header in response

2. **Check if cookie is being received:**
   - Look at server logs when `/auth/callback` is called
   - Check what cookies are in the request

3. **Verify ngrok URL:**
   ```bash
   # Make sure SHOPIFY_APP_URL matches your current ngrok URL
   echo $SHOPIFY_APP_URL
   ```

4. **Test cookie persistence:**
   - Open browser DevTools → Application → Cookies
   - Visit `/auth?shop=your-store.myshopify.com`
   - Check if `shopify_app_state` cookie is set
   - Complete OAuth flow
   - Check if cookie is still present when callback is received

## Quick Fix (Based on Your Logs)

Your logs show the cookie IS being set correctly, but ngrok's interstitial is clearing it. Here's the exact fix:

### Step-by-Step Solution:

1. **Open your ngrok URL directly in the browser:**
   ```
   https://839b197dbcfc.ngrok-free.app
   ```

2. **If you see ngrok's interstitial page:**
   - Click the "Visit Site" button
   - This sets the `abuse_interstitial` bypass cookie
   - Wait for the page to load

3. **Visit the bypass helper page:**
   ```
   https://839b197dbcfc.ngrok-free.app/ngrok-bypass.html
   ```
   This page will verify the bypass cookie is set

4. **THEN start the OAuth flow:**
   ```
   https://839b197dbcfc.ngrok-free.app/auth?shop=peek-dev-store.myshopify.com
   ```

5. **Complete the OAuth flow quickly** (within 60 seconds)

### Why This Works:

- The bypass cookie prevents ngrok from showing the interstitial
- Without the interstitial, cookies persist through redirects
- The `shopify_app_state` cookie will be preserved

### Alternative: Use ngrok with Static Domain

For a more permanent solution, get a free ngrok account and static domain:

```bash
# Sign up at ngrok.com and get your authtoken
ngrok config add-authtoken YOUR_AUTH_TOKEN

# Start ngrok with a static domain (free tier)
ngrok http 3000 --domain=your-static-domain.ngrok-free.app
```

Then update `.env`:
```bash
SHOPIFY_APP_URL=https://your-static-domain.ngrok-free.app
```

## Production

For production, use:
- A proper domain with SSL certificate
- Or ngrok paid plan with static domain
- Never use ngrok free tier for production

