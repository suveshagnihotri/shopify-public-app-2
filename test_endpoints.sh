#!/bin/bash

# Test script for all Shopify app endpoints
BASE_URL="http://localhost:3000"

echo "=========================================="
echo "Testing Shopify Public App Endpoints"
echo "=========================================="
echo ""

# Test 1: GET / - Home page
echo "1. Testing GET / (Home page)"
echo "----------------------------------------"
curl -s -w "\nHTTP Status: %{http_code}\n" "$BASE_URL/" | head -20
echo ""
echo ""

# Test 2: GET /auth - OAuth start (without shop parameter - should fail)
echo "2. Testing GET /auth (without shop parameter - should return 400)"
echo "----------------------------------------"
curl -s -w "\nHTTP Status: %{http_code}\n" "$BASE_URL/auth"
echo ""
echo ""

# Test 3: GET /auth - OAuth start (with shop parameter)
echo "3. Testing GET /auth?shop=example.myshopify.com (OAuth start)"
echo "----------------------------------------"
curl -s -L -w "\nHTTP Status: %{http_code}\n" -o /dev/null "$BASE_URL/auth?shop=example.myshopify.com" 2>&1 | head -5
echo "Note: This will redirect to Shopify OAuth page"
echo ""
echo ""

# Test 4: GET /auth/callback - OAuth callback (without proper params - will fail)
echo "4. Testing GET /auth/callback (without OAuth params - will fail)"
echo "----------------------------------------"
curl -s -w "\nHTTP Status: %{http_code}\n" "$BASE_URL/auth/callback"
echo ""
echo ""

# Test 5: GET /api/products - Products API (without auth - should return 401)
echo "5. Testing GET /api/products (without authentication - should return 401)"
echo "----------------------------------------"
curl -s -w "\nHTTP Status: %{http_code}\n" "$BASE_URL/api/products"
echo ""
echo ""

# Test 6: GET /api/products - Products API (with shop parameter but no session)
echo "6. Testing GET /api/products?shop=example.myshopify.com (with shop but no session)"
echo "----------------------------------------"
curl -s -w "\nHTTP Status: %{http_code}\n" "$BASE_URL/api/products?shop=example.myshopify.com"
echo ""
echo ""

# Test 7: POST /webhooks - Webhook endpoint (app/uninstalled)
echo "7. Testing POST /webhooks (app/uninstalled webhook)"
echo "----------------------------------------"
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: app/uninstalled" \
  -H "x-shopify-shop-domain: example.myshopify.com" \
  -H "x-shopify-hmac-sha256: test-hmac" \
  -d '{"shop_domain":"example.myshopify.com"}' \
  -w "\nHTTP Status: %{http_code}\n" \
  "$BASE_URL/webhooks"
echo ""
echo ""

# Test 8: POST /webhooks - Webhook endpoint (products/create)
echo "8. Testing POST /webhooks (products/create webhook)"
echo "----------------------------------------"
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: products/create" \
  -H "x-shopify-shop-domain: example.myshopify.com" \
  -H "x-shopify-hmac-sha256: test-hmac" \
  -d '{"id":123456,"title":"Test Product","vendor":"Test Vendor"}' \
  -w "\nHTTP Status: %{http_code}\n" \
  "$BASE_URL/webhooks"
echo ""
echo ""

# Test 9: POST /webhooks - Webhook endpoint (products/update)
echo "9. Testing POST /webhooks (products/update webhook)"
echo "----------------------------------------"
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: products/update" \
  -H "x-shopify-shop-domain: example.myshopify.com" \
  -H "x-shopify-hmac-sha256: test-hmac" \
  -d '{"id":123456,"title":"Updated Product","vendor":"Test Vendor"}' \
  -w "\nHTTP Status: %{http_code}\n" \
  "$BASE_URL/webhooks"
echo ""
echo ""

echo "=========================================="
echo "Testing Complete"
echo "=========================================="

