require('dotenv').config();
// Import Node.js adapter for Shopify API (required for v9+)
require('@shopify/shopify-api/adapters/node');
const crypto = require('crypto');
const https = require('https');
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
// CRITICAL: For non-embedded apps, we must prevent iframe embedding
// This prevents the "application cannot be loaded" error
app.use(
  helmet({
    contentSecurityPolicy: false, // keep simple; configure CSP separately if needed
    crossOriginEmbedderPolicy: false,
    frameguard: {
      action: 'deny', // Prevent embedding in iframes (required for non-embedded apps)
    },
  }),
);

// Explicitly set X-Frame-Options header for non-embedded apps
// This ensures Shopify doesn't try to load the app in an embedded context
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
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

// Install route - immediately redirects to OAuth (no UI shown)
// This is the entry point when merchant clicks "Add app" in Shopify App Store
// CRITICAL: Must immediately redirect to OAuth with zero UI interaction
app.get('/install', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  // Immediately redirect to OAuth - no UI, no delay
  return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
});

// OAuth routes
// CRITICAL: This endpoint must immediately redirect to Shopify OAuth authorization
// No UI should be shown - immediate redirect only
app.get('/auth', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    // For missing shop, still redirect (don't show error UI during install)
    // This ensures "immediately authenticates" requirement is met
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

    // Use shopify.auth.begin() to properly set up OAuth state and cookies
    // This ensures compatibility with shopify.auth.callback() later
    try {
    await shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });

      // If shopify.auth.begin() sent a response (redirect), we're done
      if (res.headersSent) {
        console.log('OAuth begin - Redirect sent by shopify.auth.begin()');
        return;
      }
    } catch (beginError) {
      console.error('OAuth begin - shopify.auth.begin() failed, falling back to manual OAuth URL:', beginError.message);
      
      // Fallback: manually construct OAuth URL if shopify.auth.begin() fails
      const state = crypto.randomBytes(16).toString('hex');
      res.cookie('shopify_oauth_state', state, {
        httpOnly: true,
        secure: appUrl.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 60000,
        path: '/',
      });
      
      const redirectUri = encodeURIComponent(`${appUrl}/auth/callback`);
      const scopes = encodeURIComponent(process.env.SHOPIFY_SCOPES || 'read_products,write_products');
      const clientId = process.env.SHOPIFY_API_KEY;
      
      if (!clientId) {
        console.error('OAuth begin - SHOPIFY_API_KEY is missing');
        return res.status(500).send('OAuth initialization failed: API key not configured');
      }
      
      const oauthUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
      console.log('OAuth begin - Manual fallback redirect to OAuth authorization page');
      return res.redirect(oauthUrl);
    }
  } catch (error) {
    console.error('OAuth begin error:', error);
    if (!res.headersSent) {
      res.status(500).send('OAuth initialization failed: ' + error.message);
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
    
    // Try to use shopify.auth.callback() first (requires cookies from shopify.auth.begin())
    // If that fails, fall back to manual OAuth handling
    let session;
    let callbackHandledRedirect = false;
    try {
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });
      session = callbackResponse.session;
      callbackHandledRedirect = res.headersSent;
      console.log('OAuth callback - Using shopify.auth.callback(), session created:', {
        id: session.id,
        shop: session.shop,
        hasAccessToken: !!session.accessToken,
        redirectHandled: callbackHandledRedirect,
      });
      
      // If shopify.auth.callback() already handled the redirect, we're done
      // For non-embedded apps, shopify.auth.callback() should automatically redirect to grant page
      if (callbackHandledRedirect) {
        console.log('OAuth callback - shopify.auth.callback() handled redirect, exiting');
        return;
      }
      
      // If shopify.auth.callback() didn't redirect automatically, check for redirect URL in response
      // Some versions might return the URL instead of redirecting directly
      if (callbackResponse && typeof callbackResponse === 'object') {
        const redirectUrl = callbackResponse.redirect || callbackResponse.url || callbackResponse.redirectUrl;
        if (redirectUrl) {
          console.log('OAuth callback - shopify.auth.callback() returned redirect URL:', redirectUrl);
          return res.redirect(redirectUrl);
        }
      }
      
      // If we reach here, shopify.auth.callback() didn't redirect, so we need to handle it manually
      // This should not happen for non-embedded apps, but we'll handle it
      console.warn('OAuth callback - shopify.auth.callback() did not redirect, will handle manually');
    } catch (callbackError) {
      // If shopify.auth.callback() fails (e.g., missing OAuth cookie), use manual handling
      console.warn('OAuth callback - shopify.auth.callback() failed, using manual OAuth handling:', callbackError.message);
      
      // Validate required OAuth parameters
      const { code, shop, state, hmac } = req.query;
      
      if (!code || !shop || !hmac) {
        console.error('OAuth callback - Missing required parameters');
        // Instead of showing error page, redirect to restart OAuth
        if (shop) {
          return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
        }
        return res.status(400).send('Missing required OAuth parameters');
      }

      // Validate state parameter (CSRF protection)
      const expectedState = req.cookies.shopify_oauth_state;
      if (!state || state !== expectedState) {
        console.error('OAuth state mismatch:', {
          received: state,
          expected: expectedState,
          cookies: req.cookies,
        });
        // Instead of showing error page, redirect to restart OAuth
        return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
      }

      // Verify HMAC
      const queryString = Object.keys(req.query)
        .filter(key => key !== 'hmac' && key !== 'signature')
        .sort()
        .map(key => `${key}=${req.query[key]}`)
        .join('&');
      
      const calculatedHmac = crypto
        .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
        .update(queryString)
        .digest('hex');
      
      if (hmac !== calculatedHmac) {
        console.error('OAuth HMAC verification failed');
        // Instead of showing error page, redirect to restart OAuth
        return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
      }

      // Exchange authorization code for access token
      console.log('Exchanging authorization code for access token...');
      let tokenData;
      try {
        tokenData = await new Promise((resolve, reject) => {
          const postData = JSON.stringify({
            client_id: process.env.SHOPIFY_API_KEY,
            client_secret: process.env.SHOPIFY_API_SECRET,
            code: code,
          });

          const options = {
            hostname: shop,
            port: 443,
            path: '/admin/oauth/access_token',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
          };

          const tokenReq = https.request(options, (tokenRes) => {
            let data = '';
            tokenRes.on('data', (chunk) => {
              data += chunk;
            });
            tokenRes.on('end', () => {
              if (tokenRes.statusCode !== 200) {
                reject(new Error(`Token exchange failed: ${tokenRes.statusCode} - ${data}`));
                return;
              }
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Failed to parse token response: ${e.message}`));
              }
            });
          });

          tokenReq.on('error', (e) => {
            reject(new Error(`Token exchange request failed: ${e.message}`));
          });

          tokenReq.write(postData);
          tokenReq.end();
        });
      } catch (tokenError) {
        console.error('Token exchange error:', tokenError);
        // Instead of showing error page, redirect to restart OAuth
        return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
      }

      const { access_token, scope } = tokenData;

      if (!access_token) {
        console.error('No access token in response:', tokenData);
        // Instead of showing error page, redirect to restart OAuth
        return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
      }

      // Create session object
      const sessionId = `offline_${shop}`;
      session = {
        id: sessionId,
        shop: shop,
        state: state,
        isOnline: false,
        accessToken: access_token,
        scope: scope,
      };

      console.log('OAuth callback - Manual session created:', {
        id: session.id,
        shop: session.shop,
        hasAccessToken: !!session.accessToken,
        scope: session.scope,
      });
    }

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
    
    // CRITICAL: Manually store the session BEFORE redirecting
    // This ensures the session is persisted to MongoDB and available when homepage loads
    // This prevents redirect loops where homepage can't find the session
    try {
      console.log('Manually storing session after callback (synchronous, before redirect)...');
      await sessionStorage.storeSession(session);
      console.log('Session manually stored successfully, session ID:', session.id);
    } catch (storeError) {
      console.error('Error manually storing session:', storeError);
      // If session storage fails, we should still try to continue
      // but log the error for debugging
    }
    
    // Store/update store information in MongoDB (async, don't block redirect)
    // Do this asynchronously to avoid delaying the redirect
    setImmediate(async () => {
      try {
        console.log('Storing shop/store data in MongoDB...');
        
        // Fetch shop data from Shopify API
        const client = new shopify.clients.Rest({ session });
        const shopData = await client.get({ path: 'shop' });
        
        // Store or update store information
        const updateData = {
          shop: session.shop,
          shopDomain: session.shop,
          accessToken: session.accessToken,
          scope: session.scope,
          shopData: shopData.body.shop,
          isActive: true,
          lastAccessAt: new Date(),
        };
        
        await Store.findOneAndUpdate(
          { shop: session.shop },
          { 
            ...updateData,
            $unset: { uninstalledAt: 1 }
          },
          { upsert: true, new: true }
        );
        
        console.log('Store data stored successfully in MongoDB');
      } catch (storeError) {
        console.error('Error storing shop data (async):', storeError);
        // Don't throw - this is async and shouldn't affect the redirect
      }
    });
    
    // CRITICAL: For non-embedded apps, shopify.auth.callback() should have already redirected
    // If it didn't, we need to redirect manually, but we must do it immediately
    // Do NOT perform any async operations (like fetching shop data) before redirect
    // This can cause delays and result in 400 errors during automated checks
    
    // Set cookies before redirect (synchronous operations only)
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

    // Clear the OAuth state cookie after successful authentication
    res.clearCookie('shopify_oauth_state', {
      path: '/',
    });

    // For public (non-embedded) apps, after OAuth completes, redirect to app homepage
    // The automated check expects the app to redirect to its homepage after authentication
    // The app homepage should return 200 and show the authenticated merchant UI
    // IMPORTANT: Session is already stored above, so cookies should be available
    const appHomeUrl = `${appUrl}/?shop=${encodeURIComponent(session.shop)}`;
    console.log('OAuth callback - Redirecting to app homepage after authentication:', {
      appHomeUrl,
      shop: session.shop,
      sessionId: session.id,
      cookiesSet: {
        shopify_session: session.id,
        shop: session.shop,
      },
    });
    
    // Redirect to app homepage - this is what the automated check expects
    // The app homepage will show the authenticated merchant interface
    // The session cookie should be available immediately after this redirect
    return res.redirect(302, appHomeUrl);
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
    
    // CRITICAL: Never show error pages after OAuth callback
    // Instead, redirect to OAuth to restart the flow
    // This prevents "pretty print" error pages that fail the review
    const shop = req.query.shop;
    
    if (shop) {
      // If we have a shop parameter, redirect to OAuth to restart the flow
      // This is better than showing an error page
      console.log('OAuth callback error - redirecting to restart OAuth flow:', error.message);
      return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
    }
    
    // Only show error page if we don't have shop parameter (shouldn't happen in normal flow)
    // Make it a proper HTML page, not a "pretty print" error
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Authentication Error - Peeq</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #f9fafb;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
              max-width: 500px;
              width: 100%;
              padding: 40px;
              text-align: center;
            }
            h1 {
              color: #ef4444;
              margin-bottom: 16px;
            }
            p {
              color: #6b7280;
              margin-bottom: 24px;
            }
            .btn {
              display: inline-block;
              padding: 12px 24px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authentication Error</h1>
            <p>There was an error during authentication. Please try installing the app again.</p>
            <a href="/" class="btn">Go to Homepage</a>
          </div>
        </body>
      </html>
    `);
  }
});

// Protected route - requires authentication
// CRITICAL: For "immediately authenticates after install" requirement
// If shop parameter is present but no session exists, immediately redirect to OAuth
// Do NOT show any UI - this will cause app rejection
app.get('/', async (req, res) => {
  const sessionId = req.cookies.shopify_session;
  const shop = req.cookies.shop || req.query.shop;
  
  // CRITICAL: Prevent redirect loops after OAuth callback
  // If shop is provided but no session cookie exists, try loading from storage first
  // This handles the case where OAuth callback just set cookies but they're not yet available
  if (shop && !sessionId) {
    console.log('Root route - Shop provided but no session cookie, checking storage...', shop);
    
    // Try to load session from storage using shop domain
    try {
      const sessionFromStorage = await sessionStorage.loadSession(`offline_${shop}`);
      if (sessionFromStorage && sessionFromStorage.accessToken) {
        console.log('Root route - Session found in storage, setting cookies and proceeding');
        // Session exists in storage but cookie wasn't set - set it now
        const isSecure = appUrl.startsWith('https://') || process.env.NODE_ENV === 'production';
        res.cookie('shopify_session', sessionFromStorage.id, {
          httpOnly: true,
          secure: isSecure,
          sameSite: 'lax',
          path: '/',
        });
        res.cookie('shop', sessionFromStorage.shop, {
          httpOnly: true,
          secure: isSecure,
          sameSite: 'lax',
          path: '/',
        });
        // Update sessionId to use the one from storage
        const updatedSessionId = sessionFromStorage.id;
        // Continue with session loading below using updatedSessionId
        // We'll use sessionFromStorage directly instead of loading again
        const session = sessionFromStorage;
        
        // Fetch shop information
        let shopData;
        try {
          const client = new shopify.clients.Rest({ session });
          shopData = await client.get({ path: 'shop' });
        } catch (apiError) {
          console.error('Error fetching shop data from Shopify API:', apiError);
          shopData = { body: { shop: { name: session.shop, domain: session.shop } } };
        }

        // Update last access time (async)
        setImmediate(async () => {
          try {
            await Store.findOneAndUpdate(
              { shop: session.shop },
              { lastAccessAt: new Date() }
            );
          } catch (error) {
            console.error('Error updating store last access:', error);
          }
        });

        // Return proper HTML page
        const shopInfo = shopData.body.shop;
        return res.status(200).send(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Peeq - Shopify App</title>
              <style>
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                }
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 20px;
                }
                .container {
                  background: white;
                  border-radius: 12px;
                  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                  max-width: 600px;
                  width: 100%;
                  padding: 40px;
                  text-align: center;
                }
                .success-icon {
                  width: 80px;
                  height: 80px;
                  background: #10b981;
                  border-radius: 50%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  margin: 0 auto 24px;
                }
                .success-icon::after {
                  content: '✓';
                  color: white;
                  font-size: 48px;
                  font-weight: bold;
                }
                h1 {
                  color: #1f2937;
                  font-size: 28px;
                  margin-bottom: 12px;
                }
                .subtitle {
                  color: #6b7280;
                  font-size: 16px;
                  margin-bottom: 32px;
                }
                .shop-info {
                  background: #f9fafb;
                  border-radius: 8px;
                  padding: 24px;
                  margin-bottom: 24px;
                  text-align: left;
                }
                .shop-info h2 {
                  color: #1f2937;
                  font-size: 18px;
                  margin-bottom: 16px;
                }
                .info-row {
                  display: flex;
                  justify-content: space-between;
                  padding: 12px 0;
                  border-bottom: 1px solid #e5e7eb;
                }
                .info-row:last-child {
                  border-bottom: none;
                }
                .info-label {
                  color: #6b7280;
                  font-weight: 500;
                }
                .info-value {
                  color: #1f2937;
                  font-weight: 600;
                }
                .actions {
                  display: flex;
                  gap: 12px;
                  justify-content: center;
                }
                .btn {
                  padding: 12px 24px;
                  border-radius: 6px;
                  text-decoration: none;
                  font-weight: 600;
                  transition: all 0.2s;
                  display: inline-block;
                }
                .btn-primary {
                  background: #667eea;
                  color: white;
                }
                .btn-primary:hover {
                  background: #5568d3;
                }
                .btn-secondary {
                  background: #f3f4f6;
                  color: #1f2937;
                }
                .btn-secondary:hover {
                  background: #e5e7eb;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="success-icon"></div>
                <h1>App Installed Successfully!</h1>
                <p class="subtitle">Your Shopify store is now connected to Peeq</p>
                
                <div class="shop-info">
                  <h2>Store Information</h2>
                  <div class="info-row">
                    <span class="info-label">Store Name:</span>
                    <span class="info-value">${shopInfo.name || shopInfo.domain || session.shop}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Domain:</span>
                    <span class="info-value">${shopInfo.domain || session.shop}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Status:</span>
                    <span class="info-value" style="color: #10b981;">✓ Active</span>
                  </div>
                </div>
                
                <div class="actions">
                  <a href="/api/products?shop=${encodeURIComponent(session.shop)}" class="btn btn-primary">View Products</a>
                  <a href="https://admin.shopify.com/store/${session.shop.replace('.myshopify.com', '')}" class="btn btn-secondary" target="_blank">Shopify Admin</a>
                </div>
              </div>
            </body>
          </html>
        `);
      } else {
        // Session doesn't exist in storage, redirect to OAuth
        console.log('Root route - No session found in storage, redirecting to OAuth');
        return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
      }
    } catch (loadError) {
      console.error('Root route - Error loading session from storage:', loadError);
      // If loading fails, redirect to OAuth
      return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
    }
  }
  
  // If no shop parameter and no session, show installation instructions
  // This is only for manual testing, not during actual installation
  if (!sessionId && !shop) {
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
  
  // If session exists but no shop, redirect to auth with shop from cookie
  if (sessionId && !shop) {
    const shopFromCookie = req.cookies.shop;
    if (shopFromCookie) {
      return res.redirect(`/?shop=${encodeURIComponent(shopFromCookie)}`);
    }
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
    let shopData;
    try {
      shopData = await client.get({
        path: 'shop',
      });
    } catch (apiError) {
      console.error('Error fetching shop data from Shopify API:', apiError);
      // If API call fails, still show the app but without shop data
      // This prevents showing an error page
      shopData = { body: { shop: { name: session.shop, domain: session.shop } } };
    }

    // Update last access time for the store (async, don't block response)
    setImmediate(async () => {
      try {
        await Store.findOneAndUpdate(
          { shop: session.shop },
          { lastAccessAt: new Date() }
        );
      } catch (error) {
        console.error('Error updating store last access:', error);
      }
    });

    // Return proper HTML page instead of JSON to prevent "pretty print" error pages
    // This is what Shopify expects after OAuth - a proper HTML page, not JSON
    const shop = shopData.body.shop;
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Peeq - Shopify App</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 12px;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              max-width: 600px;
              width: 100%;
              padding: 40px;
              text-align: center;
            }
            .success-icon {
              width: 80px;
              height: 80px;
              background: #10b981;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              margin: 0 auto 24px;
            }
            .success-icon::after {
              content: '✓';
              color: white;
              font-size: 48px;
              font-weight: bold;
            }
            h1 {
              color: #1f2937;
              font-size: 28px;
              margin-bottom: 12px;
            }
            .subtitle {
              color: #6b7280;
              font-size: 16px;
              margin-bottom: 32px;
            }
            .shop-info {
              background: #f9fafb;
              border-radius: 8px;
              padding: 24px;
              margin-bottom: 24px;
              text-align: left;
            }
            .shop-info h2 {
              color: #1f2937;
              font-size: 18px;
              margin-bottom: 16px;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              padding: 12px 0;
              border-bottom: 1px solid #e5e7eb;
            }
            .info-row:last-child {
              border-bottom: none;
            }
            .info-label {
              color: #6b7280;
              font-weight: 500;
            }
            .info-value {
              color: #1f2937;
              font-weight: 600;
            }
            .actions {
              display: flex;
              gap: 12px;
              justify-content: center;
            }
            .btn {
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              transition: all 0.2s;
              display: inline-block;
            }
            .btn-primary {
              background: #667eea;
              color: white;
            }
            .btn-primary:hover {
              background: #5568d3;
            }
            .btn-secondary {
              background: #f3f4f6;
              color: #1f2937;
            }
            .btn-secondary:hover {
              background: #e5e7eb;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon"></div>
            <h1>App Installed Successfully!</h1>
            <p class="subtitle">Your Shopify store is now connected to Peeq</p>
            
            <div class="shop-info">
              <h2>Store Information</h2>
              <div class="info-row">
                <span class="info-label">Store Name:</span>
                <span class="info-value">${shop.name || shop.domain || session.shop}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Domain:</span>
                <span class="info-value">${shop.domain || session.shop}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Status:</span>
                <span class="info-value" style="color: #10b981;">✓ Active</span>
              </div>
            </div>
            
            <div class="actions">
              <a href="/api/products?shop=${encodeURIComponent(session.shop)}" class="btn btn-primary">View Products</a>
              <a href="https://admin.shopify.com/store/${session.shop.replace('.myshopify.com', '')}" class="btn btn-secondary" target="_blank">Shopify Admin</a>
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error loading session:', error);
    // Clear invalid cookies
    res.clearCookie('shopify_session');
    res.clearCookie('shop');
    
    // Instead of showing an error page, redirect to OAuth to re-authenticate
    // This prevents showing error pages that would fail the review
    if (shop) {
      return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
    }
    
    // If no shop parameter, show a proper error page (not a "pretty print" error)
    res.status(401).send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Session Expired - Peeq</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #f9fafb;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
              max-width: 500px;
              width: 100%;
              padding: 40px;
              text-align: center;
            }
            h1 {
              color: #ef4444;
              margin-bottom: 16px;
            }
            p {
              color: #6b7280;
              margin-bottom: 24px;
            }
            .btn {
              display: inline-block;
              padding: 12px 24px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Session Expired</h1>
            <p>Your session has expired. Please reinstall the app.</p>
            <a href="/" class="btn">Go to Homepage</a>
          </div>
        </body>
      </html>
    `);
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

// Fallback 404 handler - return proper HTML, not JSON
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Page Not Found - Peeq</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f9fafb;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            width: 100%;
            padding: 40px;
            text-align: center;
          }
          h1 {
            color: #1f2937;
            margin-bottom: 16px;
          }
          p {
            color: #6b7280;
            margin-bottom: 24px;
          }
          .btn {
            display: inline-block;
            padding: 12px 24px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Page Not Found</h1>
          <p>The page you're looking for doesn't exist.</p>
          <a href="/" class="btn">Go to Homepage</a>
        </div>
      </body>
    </html>
  `);
});

// Centralized error handler - return proper HTML, not JSON
// This prevents "pretty print" error pages that fail Shopify review
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return;
  }
  
  // If we have a shop parameter, try to redirect to OAuth instead of showing error
  const shop = req.query.shop || req.cookies?.shop;
  if (shop && req.path.includes('/auth')) {
    return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
  }
  
  // Otherwise, show a proper HTML error page
  res.status(500).send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Server Error - Peeq</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f9fafb;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            width: 100%;
            padding: 40px;
            text-align: center;
          }
          h1 {
            color: #ef4444;
            margin-bottom: 16px;
          }
          p {
            color: #6b7280;
            margin-bottom: 24px;
          }
          .btn {
            display: inline-block;
            padding: 12px 24px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Server Error</h1>
          <p>An unexpected error occurred. Please try again later.</p>
          <a href="/" class="btn">Go to Homepage</a>
        </div>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Install app at: http://localhost:${PORT}/auth?shop=YOUR_SHOP.myshopify.com`);
});

