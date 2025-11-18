require('dotenv').config();
// Import Node.js adapter for Shopify API (required for v9+)
require('@shopify/shopify-api/adapters/node');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const { restResources } = require('@shopify/shopify-api/rest/admin/2024-04');
const SessionStorage = require('./sessionStorage');
const { connectDB } = require('./db/connection');
const Store = require('./models/Store');
const OAuthCallback = require('./models/OAuthCallback');
const Product = require('./models/Product');
const Session = require('./models/Session');
const storesRouter = require('./routes/stores');
const productsRouter = require('./routes/products');

// Basic env validation (stricter in production)
const requiredEnv = [
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_APP_URL',
  'SHOPIFY_SCOPES',
  'MONGODB_URI',
];

if (process.env.NODE_ENV === 'production') {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    // Fail fast in production so misconfiguration is obvious
    // eslint-disable-next-line no-console
    console.error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
    process.exit(1);
  }
}

const app = express();

// Trust proxy for ngrok and other reverse proxies
// This is important for correct protocol detection (HTTPS)
app.set('trust proxy', true);

// Security & performance middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // keep simple; configure CSP separately if needed
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(compression());
app.use(cookieParser());

// Skip JSON body parsing for webhook route so we can verify HMAC using raw body
app.use((req, res, next) => {
  if (req.path === '/webhooks') {
    return next();
  }
  return express.json()(req, res, next);
});

// Health check endpoint for load balancers/monitoring
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Basic rate limiting to protect public endpoints
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/auth', authLimiter);
app.use(['/api', '/webhooks'], apiLimiter);

// Middleware to handle ngrok interstitial cookie issues
// This ensures cookies persist through ngrok's redirects
app.use((req, res, next) => {
  // If this is the callback and we're missing the state cookie,
  // but we have the state in the query params, we can work around it
  if (req.path === '/auth/callback' && req.query.state) {
    // Log for debugging
    console.log('Callback middleware - Checking for state cookie workaround');
  }
  next();
});

// Serve static files (for ngrok bypass page)
app.use(express.static('public'));

// API routes for stores
app.use('/api/stores', storesRouter);

// API routes for products (from MongoDB)
app.use('/api/db/products', productsRouter);

const sessionStorage = new SessionStorage();

// Connect to MongoDB
connectDB().catch(console.error);

// Initialize Shopify API
// Note: hostName must match your app URL exactly (without protocol)
// For local development with ngrok: use your ngrok URL (e.g., 'abc123.ngrok-free.app')
// The OAuth cookies require HTTPS, so ensure your SHOPIFY_APP_URL uses https://
const appUrl = process.env.SHOPIFY_APP_URL || 'http://localhost:3000';
const hostName = appUrl.replace(/https?:\/\//, '').split('/')[0]; // Remove protocol and path

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES?.split(',') || ['read_products', 'write_products'],
  hostName: hostName,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: false,
  restResources,
  sessionStorage: {
    async storeSession(session) {
      console.log('Shopify API calling storeSession:', {
        id: session?.id,
        shop: session?.shop,
        hasAccessToken: !!session?.accessToken,
      });
      try {
        const result = await sessionStorage.storeSession(session);
        console.log('storeSession completed:', result);
        return result;
      } catch (error) {
        console.error('storeSession error:', error);
        throw error;
      }
    },
    async loadSession(id) {
      console.log('Shopify API calling loadSession:', id);
      return await sessionStorage.loadSession(id);
    },
    async deleteSession(id) {
      console.log('Shopify API calling deleteSession:', id);
      return await sessionStorage.deleteSession(id);
    },
    async deleteSessions(ids) {
      console.log('Shopify API calling deleteSessions:', ids);
      return await sessionStorage.deleteSessions(ids);
    },
  },
});

// OAuth routes
app.get('/auth', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  // Validate shop domain format
  if (!shop.endsWith('.myshopify.com') && !shop.includes('.')) {
    return res.status(400).send('Invalid shop parameter. Must be a valid Shopify domain (e.g., example.myshopify.com)');
  }

  try {
    // Log request details for debugging
    console.log('OAuth begin - Request details:', {
      shop,
      host: req.get('host'),
      protocol: req.protocol,
      url: req.url,
      cookies: req.cookies,
      headers: {
        'user-agent': req.get('user-agent'),
        'referer': req.get('referer'),
      },
    });

    // shopify.auth.begin() handles the redirect internally via rawResponse
    // For non-embedded apps, this should redirect to Shopify's OAuth authorization page
    // Note: Shopify API returns 410 for bot User-Agents (like curl) as a security measure
    // Use a browser or set User-Agent header to test OAuth flow
    const authResponse = await shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });

    // For non-embedded apps, shopify.auth.begin() should redirect automatically
    // If it returns a response object, we need to handle the redirect manually
    if (authResponse && authResponse.url && !res.headersSent) {
      console.log('OAuth begin - Manual redirect needed:', authResponse.url);
      return res.redirect(authResponse.url);
    }

    // Verify that a redirect was initiated
    if (!res.headersSent) {
      console.error('OAuth begin - No redirect was sent by shopify.auth.begin()');
      // Manually construct OAuth URL as fallback for non-embedded apps
      // Generate a state parameter for security
      const state = crypto.randomBytes(16).toString('hex');
      // Store state in cookie for verification in callback
      res.cookie('shopify_oauth_state', state, {
        httpOnly: true,
        secure: appUrl.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 60000, // 60 seconds
        path: '/',
      });
      const redirectUri = encodeURIComponent(`${appUrl}/auth/callback`);
      const scopes = encodeURIComponent(process.env.SHOPIFY_SCOPES || 'read_products,write_products');
      const clientId = process.env.SHOPIFY_API_KEY;
      const oauthUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
      console.log('OAuth begin - Falling back to manual OAuth URL construction');
      return res.redirect(oauthUrl);
    }

    // Log response headers to see what cookies were set
    const location = res.get('Location');
    console.log('OAuth begin - Response headers:', {
      'set-cookie': res.get('Set-Cookie'),
      location: location,
      headersSent: res.headersSent,
      statusCode: res.statusCode,
    });

    // Verify redirect is to Shopify OAuth page
    if (location && !location.includes('myshopify.com/admin/oauth/authorize')) {
      console.warn('OAuth begin - Unexpected redirect location:', location);
    }
  } catch (error) {
    console.error('OAuth begin error:', error);
    // If response already sent (410 from Shopify API for bots), don't send again
    if (!res.headersSent) {
      // Try manual OAuth URL construction as fallback
      try {
        // Generate a state parameter for security
        const state = crypto.randomBytes(16).toString('hex');
        // Store state in cookie for verification in callback
        res.cookie('shopify_oauth_state', state, {
          httpOnly: true,
          secure: appUrl.startsWith('https://'),
          sameSite: 'lax',
          maxAge: 60000, // 60 seconds
          path: '/',
        });
        const redirectUri = encodeURIComponent(`${appUrl}/auth/callback`);
        const scopes = encodeURIComponent(process.env.SHOPIFY_SCOPES || 'read_products,write_products');
        const clientId = process.env.SHOPIFY_API_KEY;
        const oauthUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
        console.log('OAuth begin - Error fallback: redirecting to manually constructed OAuth URL');
        return res.redirect(oauthUrl);
      } catch (fallbackError) {
        console.error('OAuth begin - Fallback also failed:', fallbackError);
        res.status(500).send('OAuth initialization failed: ' + error.message);
      }
    }
  }
});

app.get('/auth/callback', async (req, res) => {
  // Store OAuth callback data in MongoDB
  let callbackRecord = null;
  try {
    // Store callback request data
    const callbackData = {
      shop: req.query.shop,
      code: req.query.code,
      state: req.query.state,
      hmac: req.query.hmac,
      host: req.query.host,
      timestamp: req.query.timestamp,
      callbackData: {
        query: req.query,
        headers: {
          host: req.get('host'),
          protocol: req.protocol,
          userAgent: req.get('user-agent'),
          referer: req.get('referer'),
        },
        cookies: req.cookies,
        url: req.url,
      },
    };

    callbackRecord = await OAuthCallback.create(callbackData);
    console.log('OAuth callback data stored:', {
      id: callbackRecord._id,
      shop: callbackRecord.shop,
      hasCode: !!callbackRecord.code,
      hasState: !!callbackRecord.state,
    });
  } catch (callbackStoreError) {
    console.error('Error storing OAuth callback data:', callbackStoreError);
    // Continue with OAuth flow even if callback storage fails
  }

  try {
    // Log cookies for debugging
    console.log('Callback received - Request details:', {
      shop: req.query.shop,
      code: req.query.code ? 'present' : 'missing',
      state: req.query.state,
      hmac: req.query.hmac ? 'present' : 'missing',
      host: req.get('host'),
      protocol: req.protocol,
      url: req.url,
      cookies: req.cookies,
      cookieHeader: req.headers.cookie,
      allHeaders: Object.keys(req.headers).reduce((acc, key) => {
        if (key.toLowerCase().includes('cookie') || key.toLowerCase().includes('set-cookie')) {
          acc[key] = req.headers[key];
        }
        return acc;
      }, {}),
    });
    
    // Check if the OAuth state cookie exists
    const stateCookieName = 'shopify_app_state';
    if (!req.cookies[stateCookieName] && !req.headers.cookie?.includes(stateCookieName)) {
      console.error('OAuth state cookie missing! This usually means:');
      console.error('1. Cookie was not set during /auth (check logs above)');
      console.error('2. Cookie was blocked by browser/ngrok');
      console.error('3. Cookie expired (60 second timeout)');
      console.error('4. Domain/path mismatch between /auth and /auth/callback');
      console.error('5. ngrok interstitial page cleared cookies');
    }
    
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callbackResponse;

    // Update callback record with session ID and success status
    if (callbackRecord) {
      try {
        await OAuthCallback.findByIdAndUpdate(callbackRecord._id, {
          sessionId: session.id,
          success: true,
        });
      } catch (updateError) {
        console.error('Error updating callback record:', updateError);
      }
    }
    
    // Log session details for debugging
    console.log('OAuth callback - Session created:', {
      id: session.id,
      shop: session.shop,
      hasAccessToken: !!session.accessToken,
      accessTokenLength: session.accessToken?.length,
      expires: session.expires,
      scope: session.scope,
    });
    
    // Manually store the session since Shopify API may not be calling storeSession
    // This ensures the session is persisted to MongoDB
    try {
      console.log('Manually storing session after callback...');
      await sessionStorage.storeSession(session);
      console.log('Session manually stored successfully');
    } catch (storeError) {
      console.error('Error manually storing session:', storeError);
      // Don't throw - continue with OAuth flow even if storage fails
      // The session might still be usable
    }
    
    // Store/update store information in MongoDB
    try {
      console.log('Storing shop/store data in MongoDB...');
      
      // Fetch shop data from Shopify API
      const client = new shopify.clients.Rest({ session });
      const shopData = await client.get({ path: 'shop' });
      
      // Log what shop data we received
      console.log('Shop data received from Shopify API:', {
        id: shopData.body.shop?.id,
        name: shopData.body.shop?.name,
        domain: shopData.body.shop?.domain,
        email: shopData.body.shop?.email,
        country: shopData.body.shop?.country,
        currency: shopData.body.shop?.currency,
        plan: shopData.body.shop?.plan_name,
        totalFields: Object.keys(shopData.body.shop || {}).length,
      });
      
      // Store or update store information
      // shopData.body.shop contains ALL shop information including:
      // id, name, email, domain, country, currency, timezone, plan details,
      // payment settings, location info, and all other shop metadata
      const updateData = {
        shop: session.shop,
        shopDomain: session.shop,
        accessToken: session.accessToken,
        scope: session.scope,
        shopData: shopData.body.shop, // Complete shop object with all fields
        isActive: true,
        lastAccessAt: new Date(),
      };
      
      const savedStore = await Store.findOneAndUpdate(
        { shop: session.shop },
        { 
          ...updateData,
          $unset: { uninstalledAt: 1 } // Remove uninstalledAt if it exists
        },
        { upsert: true, new: true }
      );
      
      console.log('Store data stored successfully in MongoDB:', {
        shop: session.shop,
        shopName: shopData.body.shop?.name,
        shopId: shopData.body.shop?.id,
        email: shopData.body.shop?.email,
        domain: shopData.body.shop?.domain,
        country: shopData.body.shop?.country,
        currency: shopData.body.shop?.currency,
        plan: shopData.body.shop?.plan_name,
        fieldsStored: savedStore?.shopData ? Object.keys(savedStore.shopData).length : 0,
        storedInDB: !!savedStore,
      });
    } catch (storeError) {
      console.error('Error storing shop data:', storeError);
      // Don't throw - continue with OAuth flow even if store data storage fails
    }
    
    // Verify session was stored
    const storedSession = await sessionStorage.loadSession(session.id);
    console.log('OAuth callback - Session stored check:', {
      found: !!storedSession,
      hasAccessToken: !!storedSession?.accessToken,
    });
    
    // Session is automatically stored by sessionStorage
    // Use secure cookies if using HTTPS (ngrok or production)
    const isSecure = appUrl.startsWith('https://') || process.env.NODE_ENV === 'production';
    
    res.cookie('shopify_session', session.id, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
    });
    res.cookie('shop', session.shop, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
    });

    // For public (non-embedded) apps, redirect to Shopify admin grant page
    // The grant page URL uses the 'host' parameter from the callback query
    // Format: https://admin.shopify.com/store/{host}/app/grant
    const host = req.query.host;
    if (host) {
      const grantPageUrl = `https://admin.shopify.com/store/${host}/app/grant`;
      res.redirect(grantPageUrl);
    } else {
      // Fallback: redirect to app home if host is missing
      res.redirect('/');
    }
  } catch (error) {
    // Update callback record with error
    if (callbackRecord) {
      try {
        await OAuthCallback.findByIdAndUpdate(callbackRecord._id, {
          success: false,
          error: error.message,
        });
      } catch (updateError) {
        console.error('Error updating callback record with error:', updateError);
      }
    }

    console.error('OAuth callback error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      cookies: req.cookies,
      headers: req.headers.cookie,
    });
    
    // Provide helpful error message
    if (error.message && error.message.includes('Could not find OAuth cookie')) {
      res.status(400).send(`
        <html>
          <head><title>OAuth Error</title></head>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1>OAuth Authentication Error</h1>
            <p><strong>Error:</strong> Could not find OAuth cookie</p>
            <p>This usually happens when:</p>
            <ul>
              <li>The OAuth flow took too long (cookies expire after 60 seconds)</li>
              <li>Cookies are blocked by browser settings</li>
              <li>Using HTTP instead of HTTPS (cookies require HTTPS)</li>
              <li>Domain mismatch between initial request and callback</li>
            </ul>
            <p><strong>Solution:</strong></p>
            <ol>
              <li>Ensure SHOPIFY_APP_URL in .env uses HTTPS (e.g., ngrok URL)</li>
              <li>Try the OAuth flow again</li>
              <li>Complete the flow quickly (within 60 seconds)</li>
              <li>Check browser cookie settings</li>
            </ol>
            <p><a href="/auth?shop=${req.query.shop || 'YOUR_SHOP.myshopify.com'}">Try Again</a></p>
          </body>
        </html>
      `);
    } else {
      res.status(500).send('Authentication failed: ' + error.message);
    }
  }
});

// Protected route - requires authentication
app.get('/', async (req, res) => {
  const sessionId = req.cookies.shopify_session;
  const shop = req.cookies.shop || req.query.shop;
  
  if (!sessionId || !shop) {
    return res.send(`
      <html>
        <head><title>Shopify Public App</title></head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1>Shopify Public App</h1>
          <p>Please install the app on your Shopify store.</p>
          <p><strong>Important:</strong> If using ngrok, visit <a href="/ngrok-bypass.html">/ngrok-bypass.html</a> first to set the bypass cookie.</p>
          <p>Install URL format: <code>/auth?shop=YOUR_SHOP.myshopify.com</code></p>
          <p>Example: <a href="/auth?shop=example.myshopify.com">/auth?shop=example.myshopify.com</a></p>
        </body>
      </html>
    `);
  }

  try {
    console.log('Loading session - Request details:', {
      sessionId,
      shop,
      cookies: req.cookies,
    });
    
    const session = await sessionStorage.loadSession(sessionId);
    
    console.log('Loaded session:', {
      found: !!session,
      hasAccessToken: !!session?.accessToken,
      sessionId: session?.id,
      shop: session?.shop,
    });
    
    if (!session || !session.accessToken) {
      console.error('Invalid session details:', {
        sessionExists: !!session,
        sessionKeys: session ? Object.keys(session) : [],
        accessTokenExists: session?.accessToken ? 'yes' : 'no',
      });
      throw new Error('Invalid session');
    }

    const client = new shopify.clients.Rest({ session });
    
    // Fetch shop information
    const shopData = await client.get({
      path: 'shop',
    });

    // Update last access time for the store
    try {
      await Store.findOneAndUpdate(
        { shop: session.shop },
        { lastAccessAt: new Date() }
      );
    } catch (error) {
      console.error('Error updating store last access:', error);
    }

    res.json({
      message: 'App is installed and authenticated',
      shop: shopData.body.shop,
    });
  } catch (error) {
    console.error('Error loading session:', error);
    res.clearCookie('shopify_session');
    res.clearCookie('shop');
    res.status(401).send('Session expired. Please reinstall the app.');
  }
});

// API routes
app.get('/api/products', async (req, res) => {
  const sessionId = req.cookies.shopify_session;
  const shop = req.cookies.shop || req.query.shop;

  if (!sessionId || !shop) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const session = await sessionStorage.loadSession(sessionId);
    
    if (!session || !session.accessToken) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const client = new shopify.clients.Rest({ session });

    const products = await client.get({
      path: 'products',
    });

    // Store products in MongoDB
    if (products.body.products && Array.isArray(products.body.products)) {
      try {
        console.log(`Storing ${products.body.products.length} products in MongoDB...`);
        
        const productPromises = products.body.products.map(async (product) => {
          const productData = {
            shop: shop,
            productId: product.id,
            shopifyProductId: product.id,
            title: product.title,
            vendor: product.vendor,
            productType: product.product_type,
            handle: product.handle,
            status: product.status || 'active',
            productData: product, // Complete product object with variants, images, etc.
            syncedAt: new Date(),
          };

          return Product.findOneAndUpdate(
            { shop: shop, shopifyProductId: product.id },
            productData,
            { upsert: true, new: true }
          );
        });

        await Promise.all(productPromises);
        console.log(`Successfully stored ${products.body.products.length} products for ${shop}`);
      } catch (productStoreError) {
        console.error('Error storing products:', productStoreError);
        // Continue - return products even if storage fails
      }
    }

    res.json(products.body);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products', details: error.message });
  }
});

// Helper to verify Shopify webhook HMAC using raw request body
function verifyShopifyWebhook(req) {
  const hmacHeader = req.get('x-shopify-hmac-sha256');
  const secret = process.env.SHOPIFY_API_SECRET;

  if (!hmacHeader || !secret) {
    return false;
  }

  const generatedHash = crypto
    .createHmac('sha256', secret)
    .update(req.body) // req.body is a Buffer from express.raw
    .digest('base64');

  const digestBuffer = Buffer.from(generatedHash, 'utf8');
  const hmacBuffer = Buffer.from(hmacHeader, 'utf8');

  if (digestBuffer.length !== hmacBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(digestBuffer, hmacBuffer);
}

// Webhook endpoint
app.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const topic = req.get('x-shopify-topic');
    const shop = req.get('x-shopify-shop-domain');

    if (!verifyShopifyWebhook(req)) {
      console.warn('Invalid Shopify webhook signature', { topic, shop });
      return res.status(401).send('Invalid webhook signature');
    }

    console.log(`Webhook received: ${topic} from ${shop}`);

    // Process webhook based on topic
    switch (topic) {
      case 'app/uninstalled':
        // Handle app uninstall - clean up sessions and mark store as uninstalled
        console.log('App uninstalled from:', shop);
        await sessionStorage.deleteSessionsByShop(shop);
        
        // Mark store as uninstalled in MongoDB
        try {
          await Store.findOneAndUpdate(
            { shop: shop },
            {
              isActive: false,
              uninstalledAt: new Date(),
            }
          );
          console.log('Store marked as uninstalled:', shop);
        } catch (error) {
          console.error('Error updating store uninstall status:', error);
        }
        break;

      // Mandatory GDPR compliance webhooks
      // Reference: https://shopify.dev/docs/apps/build/compliance/privacy-law-zd
      case 'customers/data_request':
        // Customer has requested their data (GDPR Article 15 - Right of access)
        // You must provide the requested data within 30 days
        try {
          const data = JSON.parse(req.body.toString());
          const customerId = data.customer?.id;
          const customerEmail = data.customer?.email;
          
          console.log('Customer data request received:', {
            shop,
            customerId,
            email: customerEmail,
            requestedAt: data.created_at,
          });
          
          // TODO: Implement data export logic
          // If you store customer data, export it here
          // Example: Query your database for customer-related data
          // const customerData = await Customer.find({ shop, customerId });
          // Then provide this data to the customer (email, API endpoint, etc.)
          
          // For now, log the request for manual processing
          // In production, you should:
          // 1. Query all customer data from your database
          // 2. Format it according to GDPR requirements
          // 3. Provide it to the customer (via email, secure download, etc.)
          
          console.log('Customer data request logged - manual processing required');
        } catch (error) {
          console.error('Error processing customer data request:', error);
        }
        break;

      case 'customers/redact':
        // Customer has requested data deletion (GDPR Article 17 - Right to erasure)
        // You must delete all customer data within 30 days
        try {
          const data = JSON.parse(req.body.toString());
          const customerId = data.customer?.id;
          const customerEmail = data.customer?.email;
          
          console.log('Customer redact request received:', {
            shop,
            customerId,
            email: customerEmail,
            requestedAt: data.created_at,
          });
          
          // Delete customer data from your database
          // TODO: If you store customer-specific data, delete it here
          // Example: await Customer.deleteMany({ shop, customerId });
          
          // Note: Product data is shop-level, not customer-specific, so we don't delete it
          // Only delete data that directly identifies or relates to the customer
          
          console.log('Customer data deletion completed');
        } catch (error) {
          console.error('Error processing customer redact request:', error);
        }
        break;

      case 'shop/redact':
        // Shop has requested data deletion (GDPR Article 17)
        // Triggered 48 hours after app uninstall
        // You must delete all shop data within 30 days
        try {
          const data = JSON.parse(req.body.toString());
          
          console.log('Shop redact request received:', {
            shop,
            requestedAt: data.created_at,
          });
          
          // Delete all shop-related data from your database
          // This includes: Store, Product, Session, OAuthCallback data
          
          const deletionResults = {
            store: 0,
            products: 0,
            sessions: 0,
            oauthCallbacks: 0,
          };
          
          // Delete store data
          try {
            const storeResult = await Store.deleteOne({ shop });
            deletionResults.store = storeResult.deletedCount;
            console.log(`Deleted store data: ${deletionResults.store} record(s)`);
          } catch (error) {
            console.error('Error deleting store data:', error);
          }
          
          // Delete product data
          try {
            const productResult = await Product.deleteMany({ shop });
            deletionResults.products = productResult.deletedCount;
            console.log(`Deleted product data: ${deletionResults.products} record(s)`);
          } catch (error) {
            console.error('Error deleting product data:', error);
          }
          
          // Delete session data
          try {
            // Count sessions before deletion
            const sessionCount = await Session.countDocuments({ shop });
            await sessionStorage.deleteSessionsByShop(shop);
            deletionResults.sessions = sessionCount;
            console.log(`Deleted session data: ${deletionResults.sessions} record(s)`);
          } catch (error) {
            console.error('Error deleting session data:', error);
          }
          
          // Delete OAuth callback data
          try {
            const callbackResult = await OAuthCallback.deleteMany({ shop });
            deletionResults.oauthCallbacks = callbackResult.deletedCount;
            console.log(`Deleted OAuth callback data: ${deletionResults.oauthCallbacks} record(s)`);
          } catch (error) {
            console.error('Error deleting OAuth callback data:', error);
          }
          
          console.log('Shop redact completed:', deletionResults);
        } catch (error) {
          console.error('Error processing shop redact request:', error);
        }
        break;

      case 'products/create':
      case 'products/update':
        // Handle product events - store/update product in MongoDB
        try {
          const product = JSON.parse(req.body.toString());
          console.log('Product event received:', {
            topic,
            productId: product.id,
            title: product.title,
            shop: shop,
          });

          // Store or update product in MongoDB
          const productData = {
            shop: shop,
            productId: product.id,
            shopifyProductId: product.id,
            title: product.title,
            vendor: product.vendor,
            productType: product.product_type,
            handle: product.handle,
            status: product.status || 'active',
            productData: product, // Complete product object with variants, images, etc.
            syncedAt: new Date(),
          };

          await Product.findOneAndUpdate(
            { shop: shop, shopifyProductId: product.id },
            productData,
            { upsert: true, new: true }
          );

          console.log('Product stored/updated in MongoDB:', {
            productId: product.id,
            title: product.title,
            shop: shop,
          });
        } catch (productError) {
          console.error('Error processing product webhook:', productError);
        }
        break;

      default:
        console.log('Unhandled webhook topic:', topic);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Webhook processing failed');
  }
});

// Fallback 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Install app at: http://localhost:${PORT}/auth?shop=YOUR_SHOP.myshopify.com`);
});

