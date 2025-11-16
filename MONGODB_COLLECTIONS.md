# MongoDB Collections

This document lists all MongoDB collections used in the Shopify Public App.

## Collections

### 1. `oauthcallbacks`
**Model:** `OAuthCallback` (from `models/OAuthCallback.js`)

**Purpose:** Stores OAuth callback request data for tracking and debugging

**Schema Fields:**
- `shop` (String, indexed) - Shopify store domain
- `code` (String) - OAuth authorization code
- `state` (String) - OAuth state parameter
- `hmac` (String) - HMAC signature
- `host` (String) - Host parameter
- `timestamp` (String) - Timestamp from callback
- `callbackData` (Mixed) - Complete callback data including query params, headers, cookies
- `sessionId` (String, indexed) - Associated session ID
- `success` (Boolean, indexed) - Whether callback was successful
- `error` (String) - Error message if callback failed
- `createdAt` (Date) - Auto-generated timestamp
- `updatedAt` (Date) - Auto-generated timestamp

**Indexes:**
- `shop` + `createdAt` (compound, descending)
- `sessionId`
- `success`

---

### 2. `products`
**Model:** `Product` (from `models/Product.js`)

**Purpose:** Stores Shopify product data

**Schema Fields:**
- `shop` (String, indexed) - Shopify store domain
- `productId` (Number, indexed) - Product ID
- `shopifyProductId` (Number, unique, indexed) - Shopify product ID
- `title` (String, indexed) - Product title
- `vendor` (String, indexed) - Product vendor
- `productType` (String, indexed) - Product type
- `handle` (String, indexed) - Product handle/URL slug
- `status` (String, enum) - Product status (active, archived, draft)
- `productData` (Mixed) - Complete product object from Shopify API
  - Contains all product fields: variants, images, options, tags, metafields, etc.
- `syncedAt` (Date) - Last sync time
- `createdAt` (Date) - Auto-generated timestamp
- `updatedAt` (Date) - Auto-generated timestamp

**Indexes:**
- `shop` + `productId` (compound)
- `shop` + `status` (compound)
- `shop` + `createdAt` (compound, descending)
- Text search on `title`, `vendor`, `productType`

---

### 3. `sessions`
**Model:** `Session` (from `models/Session.js`)

**Purpose:** Stores Shopify OAuth session data

**Schema Fields:**
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

**Indexes:**
- `id` (unique)
- `shop` + `id` (compound)
- `expires` (with TTL)

---

### 4. `stores`
**Model:** `Store` (from `models/Store.js`)

**Purpose:** Stores Shopify store information and metadata

**Schema Fields:**
- `shop` (String, unique, indexed) - Shopify store domain
- `shopDomain` (String, indexed) - Store domain (same as shop)
- `accessToken` (String) - Shopify access token
- `scope` (String) - OAuth scopes granted
- `shopData` (Mixed) - Complete shop object from Shopify API
  - Contains all shop fields: id, name, email, domain, country, currency, timezone, plan details, payment settings, location info, etc.
- `isActive` (Boolean) - Whether the app is currently installed
- `installedAt` (Date) - When the app was first installed
- `lastAccessAt` (Date) - Last time the store accessed the app
- `uninstalledAt` (Date) - When the app was uninstalled (if applicable)
- `createdAt` (Date) - Auto-generated timestamp
- `updatedAt` (Date) - Auto-generated timestamp

**Indexes:**
- `shop` (unique)
- `shopDomain`
- `isActive`

---

## Database Name

Default database: `shopify_app`

Can be configured via `MONGODB_URI` environment variable:
```bash
MONGODB_URI=mongodb://localhost:27017/shopify_app
```

---

## Querying Collections

### Using MongoDB Shell

```bash
# Connect to MongoDB
mongosh mongodb://localhost:27017/shopify_app

# View all sessions
db.sessions.find().pretty()

# View all stores
db.stores.find().pretty()

# View all products
db.products.find().pretty()

# View OAuth callbacks
db.oauthcallbacks.find().sort({ createdAt: -1 }).pretty()

# View specific store
db.stores.findOne({ shop: "peek-dev-store.myshopify.com" })

# View products for a shop
db.products.find({ shop: "peek-dev-store.myshopify.com" }).pretty()

# Count active stores
db.stores.countDocuments({ isActive: true })

# Count products
db.products.countDocuments({ shop: "peek-dev-store.myshopify.com" })
```

### Using MongoDB Compass

1. Connect to: `mongodb://localhost:27017`
2. Select database: `shopify_app`
3. Browse collections: `sessions`, `stores`, `products`, and `oauthcallbacks`

---

## Collection Naming Convention

Mongoose automatically:
- Converts model name to lowercase
- Pluralizes the name
- Example: `Session` model → `sessions` collection
- Example: `Store` model → `stores` collection
- Example: `Product` model → `products` collection
- Example: `OAuthCallback` model → `oauthcallbacks` collection

To use a custom collection name, specify it in the schema:
```javascript
const storeSchema = new mongoose.Schema({...}, {
  collection: 'custom_collection_name'
});
```

