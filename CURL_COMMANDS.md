# cURL Commands for All Endpoints

## Prerequisites
- Server must be running on `http://localhost:3000`
- For authenticated endpoints, you need a valid session cookie

## Endpoints

### 1. GET / - Home Page
```bash
curl -v http://localhost:3000/
```

**Expected Response:**
- If not authenticated: HTML page with installation instructions
- If authenticated: JSON with shop information

---

### 2. GET /auth - Start OAuth Flow

**Without shop parameter (should return 400):**
```bash
curl -v http://localhost:3000/auth
```

**With shop parameter (use browser User-Agent to avoid 410 error):**
```bash
curl -v -L \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "http://localhost:3000/auth?shop=example.myshopify.com"
```
*Note: Shopify API returns 410 for bot User-Agents. Use a browser-like User-Agent header or test in a browser.*

---

### 3. GET /auth/callback - OAuth Callback

**Without OAuth parameters (will fail):**
```bash
curl -v "http://localhost:3000/auth/callback"
```

**With OAuth parameters (from Shopify redirect):**
```bash
curl -v -c cookies.txt -b cookies.txt \
  "http://localhost:3000/auth/callback?code=AUTH_CODE&shop=example.myshopify.com&state=STATE&hmac=HMAC"
```
*Note: This endpoint is typically called by Shopify after OAuth approval*

---

### 4. GET /api/products - Get Products (Requires Authentication)

**Without authentication (should return 401):**
```bash
curl -v http://localhost:3000/api/products
```

**With shop parameter but no session (should return 401):**
```bash
curl -v "http://localhost:3000/api/products?shop=example.myshopify.com"
```

**With valid session cookie:**
```bash
curl -v -b "shopify_session=YOUR_SESSION_ID; shop=example.myshopify.com" \
  "http://localhost:3000/api/products?shop=example.myshopify.com"
```

---

### 5. POST /webhooks - Webhook Endpoint

**App Uninstalled Webhook:**
```bash
curl -v -X POST \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: app/uninstalled" \
  -H "x-shopify-shop-domain: example.myshopify.com" \
  -H "x-shopify-hmac-sha256: test-hmac" \
  -d '{"shop_domain":"example.myshopify.com"}' \
  http://localhost:3000/webhooks
```

**Product Created Webhook:**
```bash
curl -v -X POST \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: products/create" \
  -H "x-shopify-shop-domain: example.myshopify.com" \
  -H "x-shopify-hmac-sha256: test-hmac" \
  -d '{
    "id": 123456789,
    "title": "Test Product",
    "vendor": "Test Vendor",
    "product_type": "Test Type",
    "created_at": "2024-01-01T00:00:00Z"
  }' \
  http://localhost:3000/webhooks
```

**Product Updated Webhook:**
```bash
curl -v -X POST \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: products/update" \
  -H "x-shopify-shop-domain: example.myshopify.com" \
  -H "x-shopify-hmac-sha256: test-hmac" \
  -d '{
    "id": 123456789,
    "title": "Updated Product",
    "vendor": "Test Vendor",
    "product_type": "Test Type",
    "updated_at": "2024-01-01T00:00:00Z"
  }' \
  http://localhost:3000/webhooks
```

---

## Testing with Cookie Storage

To save and reuse cookies from OAuth flow:

```bash
# Save cookies from OAuth callback
curl -c cookies.txt -b cookies.txt \
  "http://localhost:3000/auth/callback?code=CODE&shop=SHOP&state=STATE&hmac=HMAC"

# Use saved cookies for authenticated requests
curl -b cookies.txt "http://localhost:3000/api/products?shop=example.myshopify.com"
```

---

## Quick Test All Endpoints

Run the test script:
```bash
./test_endpoints.sh
```

Or test individually:
```bash
# 1. Home page
curl http://localhost:3000/

# 2. Auth without shop (error)
curl http://localhost:3000/auth

# 3. Auth with shop
curl -L "http://localhost:3000/auth?shop=example.myshopify.com"

# 4. Products without auth (error)
curl http://localhost:3000/api/products

# 5. Webhook
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: app/uninstalled" \
  -H "x-shopify-shop-domain: example.myshopify.com" \
  -d '{}' \
  http://localhost:3000/webhooks
```

