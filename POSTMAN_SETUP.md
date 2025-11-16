# Postman Collection Setup Guide

## Importing the Collection

1. Open Postman
2. Click **Import** button (top left)
3. Select **File** tab
4. Choose `Shopify_Public_App.postman_collection.json`
5. Click **Import**

## Collection Structure

The collection is organized into 4 folders:

### 1. Home
- **GET Home Page (Not Authenticated)** - Returns installation instructions
- **GET Home Page (Authenticated)** - Returns shop information with valid session

### 2. OAuth
- **GET Start OAuth (Missing Shop)** - Tests error handling
- **GET Start OAuth Flow** - Initiates OAuth flow (redirects to Shopify)
- **GET OAuth Callback** - Handles OAuth callback from Shopify
- **GET OAuth Callback (Without Params)** - Tests error handling

### 3. API
- **GET Products (No Auth)** - Tests unauthorized access
- **GET Products (With Shop, No Session)** - Tests missing session
- **GET Products (Authenticated)** - Fetches products (requires valid session)

### 4. Webhooks
- **POST App Uninstalled** - Webhook for app uninstallation
- **POST Product Created** - Webhook for product creation
- **POST Product Updated** - Webhook for product updates
- **POST Webhook (No Headers)** - Tests error handling

## Environment Variables

The collection uses the following variables (set in Collection Variables):

| Variable | Default Value | Description |
|----------|---------------|-------------|
| `base_url` | `http://localhost:3000` | Base URL of your app |
| `shop_domain` | `example.myshopify.com` | Your Shopify store domain |
| `session_id` | (empty) | Session ID from OAuth (set after auth) |
| `auth_code` | (empty) | OAuth authorization code |
| `state` | (empty) | OAuth state parameter |
| `hmac` | (empty) | OAuth HMAC signature |
| `webhook_hmac` | `test-hmac-signature` | Webhook HMAC (for testing) |

## Setting Up Variables

### Option 1: Collection Variables (Recommended)
1. Right-click on the collection
2. Select **Edit**
3. Go to **Variables** tab
4. Update values as needed

### Option 2: Environment Variables
1. Create a new Environment in Postman
2. Add the variables listed above
3. Select the environment before making requests

## Testing Workflow

### 1. Test Home Page (Unauthenticated)
```
GET {{base_url}}/
```
Should return HTML with installation instructions.

### 2. Start OAuth Flow
```
GET {{base_url}}/auth?shop={{shop_domain}}
```
- This will redirect to Shopify
- In Postman, enable "Follow redirects" in settings
- Or copy the redirect URL and open in browser

### 3. Complete OAuth in Browser
1. Open the OAuth URL in your browser
2. Approve the app installation
3. You'll be redirected to `/auth/callback` with parameters
4. Copy the `code`, `state`, and `hmac` from the URL
5. Update collection variables with these values

### 4. Test OAuth Callback
```
GET {{base_url}}/auth/callback?code={{auth_code}}&shop={{shop_domain}}&state={{state}}&hmac={{hmac}}
```
- Check response cookies for `shopify_session`
- Copy the session ID and update `session_id` variable

### 5. Test Authenticated Endpoints
```
GET {{base_url}}/api/products?shop={{shop_domain}}
```
- Add Cookie header: `shopify_session={{session_id}}; shop={{shop_domain}}`
- Should return products from your store

### 6. Test Webhooks
```
POST {{base_url}}/webhooks
```
- Include required headers:
  - `x-shopify-topic`
  - `x-shopify-shop-domain`
  - `x-shopify-hmac-sha256`
- Include JSON body with webhook data

## Tips

1. **OAuth Flow**: The OAuth flow requires browser interaction. Use Postman's "Follow redirects" or test in browser.

2. **Session Management**: After OAuth callback, extract the `shopify_session` cookie value and set it as `session_id` variable.

3. **Webhook Testing**: For local testing, use tools like ngrok to expose your local server:
   ```bash
   ngrok http 3000
   ```
   Then update `base_url` to your ngrok URL.

4. **Cookie Handling**: Postman automatically handles cookies. Make sure cookies are enabled in Postman settings.

5. **Error Testing**: The collection includes error scenarios (missing params, no auth) to test error handling.

## Example: Complete OAuth Flow

1. **Start OAuth**:
   ```
   GET http://localhost:3000/auth?shop=your-store.myshopify.com
   ```

2. **Browser Redirect**: Copy the redirect URL and open in browser

3. **Approve Installation**: Click "Install" in Shopify

4. **Get Callback URL**: Copy the full callback URL from browser

5. **Extract Parameters**: Parse the URL to get `code`, `state`, `hmac`

6. **Update Variables**: Set collection variables with extracted values

7. **Test Callback**: Run the OAuth callback request

8. **Extract Session**: Get `shopify_session` cookie from response

9. **Test API**: Use the session to make authenticated API calls

## Troubleshooting

- **401 Unauthorized**: Make sure `session_id` is set and valid
- **400 Bad Request**: Check that required parameters are provided
- **Connection Refused**: Ensure server is running on the correct port
- **OAuth Errors**: Verify `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` in `.env`

