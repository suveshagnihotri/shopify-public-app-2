#!/bin/bash

BASE_URL="http://localhost:3000"

echo "=== 1. GET / (Home Page) ==="
curl -s "$BASE_URL/" | head -10
echo -e "\n"

echo "=== 2. GET /auth (without shop - should error) ==="
curl -s "$BASE_URL/auth"
echo -e "\n"

echo "=== 3. GET /auth?shop=example.myshopify.com ==="
curl -s -I "$BASE_URL/auth?shop=example.myshopify.com" | head -5
echo -e "\n"

echo "=== 4. GET /auth/callback (without params - will error) ==="
curl -s "$BASE_URL/auth/callback"
echo -e "\n"

echo "=== 5. GET /api/products (without auth - should return 401) ==="
curl -s "$BASE_URL/api/products"
echo -e "\n"

echo "=== 6. POST /webhooks (app/uninstalled) ==="
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: app/uninstalled" \
  -H "x-shopify-shop-domain: example.myshopify.com" \
  -H "x-shopify-hmac-sha256: test" \
  -d '{"shop":"example.myshopify.com"}' \
  "$BASE_URL/webhooks"
echo -e "\n"

echo "=== 7. POST /webhooks (products/create) ==="
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: products/create" \
  -H "x-shopify-shop-domain: example.myshopify.com" \
  -H "x-shopify-hmac-sha256: test" \
  -d '{"id":123,"title":"Test Product"}' \
  "$BASE_URL/webhooks"
echo -e "\n"
