# Shopify Public App

A Node.js Shopify public app with OAuth authentication, API integration, and webhook support.

## Features

- OAuth 2.0 authentication flow
- REST API integration with Shopify
- Webhook handling
- MongoDB session storage
- Product API endpoints

## Prerequisites

- Node.js 16+ installed
- MongoDB installed locally or MongoDB Atlas account
- Shopify Partner account
- A Shopify development store (or access to a store)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a Shopify app:**
   - Go to [Shopify Partner Dashboard](https://partners.shopify.com)
   - Create a new app
   - Note your API key and secret

3. **Set up MongoDB:**
   - **Local MongoDB**: Install MongoDB locally and ensure it's running
   - **MongoDB Atlas**: Create a free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
   - Note your connection string

4. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your credentials:
   - `SHOPIFY_API_KEY`: Your app's API key
   - `SHOPIFY_API_SECRET`: Your app's API secret
   - `SHOPIFY_APP_URL`: Your app's URL (use ngrok for local development)
   - `SHOPIFY_SCOPES`: Comma-separated list of required scopes
   - `MONGODB_URI`: MongoDB connection string (default: `mongodb://localhost:27017/shopify_app`)

5. **For local development:**
   - Install [ngrok](https://ngrok.com/) or similar tunneling service
   - Run `ngrok http 3000`
   - Use the ngrok URL as your `SHOPIFY_APP_URL`
   - Update the app URL in Shopify Partner Dashboard

6. **Start the server:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```
   
   The server will automatically connect to MongoDB on startup.

## Installation

To install the app on a Shopify store:

1. Navigate to: `http://localhost:3000/auth?shop=YOUR_SHOP.myshopify.com`
2. Approve the installation
3. You'll be redirected back to your app

## API Endpoints

### Authentication
- `GET /` - Home page (shows installation status)
- `GET /auth?shop=SHOP.myshopify.com` - Start OAuth flow
- `GET /auth/callback` - OAuth callback handler

### Shopify API
- `GET /api/products?shop=SHOP.myshopify.com` - Fetch products (requires authentication)

### Store Management
- `GET /api/stores` - Get all active stores
- `GET /api/stores/:shop` - Get specific store by shop domain
- `GET /api/stores/stats/summary` - Get store statistics

### Webhooks
- `POST /webhooks` - Webhook endpoint

## Webhooks

The app handles the following webhooks:
- `app/uninstalled` - When the app is uninstalled
- `products/create` - When a product is created
- `products/update` - When a product is updated

Configure webhooks in your Shopify Partner Dashboard under App Setup > Webhooks.

## Database Schema

The app uses MongoDB with the following schemas:

### Session Model
- `id` (String, unique, indexed) - Session identifier
- `shop` (String, indexed) - Shopify store domain
- `state` (String) - OAuth state
- `isOnline` (Boolean) - Online/offline session flag
- `scope` (String) - OAuth scopes
- `expires` (Date) - Session expiration
- `accessToken` (String) - Shopify access token
- `userId` (String) - User ID (for online sessions)
- `sessionData` (Mixed) - Full session object
- `createdAt` (Date) - Auto-generated timestamp
- `updatedAt` (Date) - Auto-generated timestamp

Sessions are automatically cleaned up when they expire.

### Store Model
- `shop` (String, unique, indexed) - Shopify store domain
- `shopDomain` (String, indexed) - Store domain (same as shop)
- `accessToken` (String) - Shopify access token
- `scope` (String) - OAuth scopes granted
- `shopData` (Mixed) - Full shop information from Shopify API
- `isActive` (Boolean) - Whether the app is currently installed
- `installedAt` (Date) - When the app was first installed
- `lastAccessAt` (Date) - Last time the store accessed the app
- `uninstalledAt` (Date) - When the app was uninstalled (if applicable)
- `createdAt` (Date) - Auto-generated timestamp
- `updatedAt` (Date) - Auto-generated timestamp

Store data is automatically saved when OAuth completes and updated on each access.

## Production Considerations

- MongoDB is already configured for session storage
- Implement proper webhook verification
- Use HTTPS in production
- Set up proper error logging and monitoring
- Implement rate limiting
- Add proper security headers
- Use MongoDB Atlas or a managed MongoDB service for production
- Set up MongoDB backups and monitoring

## License

MIT

