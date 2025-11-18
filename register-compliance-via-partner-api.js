// Attempt to Register Compliance Webhooks
// Note: Compliance webhooks typically MUST be registered via Partner Dashboard UI
// This script attempts API methods, but may not work for compliance webhooks

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/shopify_app';
const WEBHOOK_URL = 'https://store-app.peeq.co.in/webhooks';

async function getAccessTokenFromDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    const Store = mongoose.model('Store', new mongoose.Schema({}, { strict: false }), 'stores');
    const store = await Store.findOne({ isActive: true }).lean();
    
    if (!store || !store.accessToken) {
      console.error('❌ No active store with access token found');
      process.exit(1);
    }
    
    await mongoose.disconnect();
    return { shop: store.shop, accessToken: store.accessToken };
  } catch (error) {
    console.error('❌ MongoDB error:', error.message);
    process.exit(1);
  }
}

async function tryRESTAPI(shop, accessToken) {
  console.log('\n📝 Method 1: Trying REST Admin API...');
  
  const topics = ['customers/data_request', 'customers/redact', 'shop/redact'];
  
  for (const topic of topics) {
    try {
      const response = await fetch(
        `https://${shop}/admin/api/2024-04/webhooks.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            webhook: {
              topic: topic,
              address: WEBHOOK_URL,
              format: 'json'
            }
          })
        }
      );
      
      const data = await response.json();
      
      if (response.ok) {
        console.log(`✅ REST API: ${topic} - Success`);
      } else {
        console.log(`❌ REST API: ${topic} - ${JSON.stringify(data.errors || data)}`);
      }
    } catch (error) {
      console.log(`❌ REST API: ${topic} - ${error.message}`);
    }
  }
}

async function tryGraphQL(shop, accessToken) {
  console.log('\n📝 Method 2: Trying GraphQL Admin API...');
  
  // Try different enum formats
  const topicVariations = [
    'CUSTOMERS_DATA_REQUEST',
    'CUSTOMERS_DATA_REQUEST',
    'customers/data_request',
    'CUSTOMERS_REDACT',
    'customers/redact',
    'SHOP_REDACT',
    'shop/redact'
  ];
  
  const mutation = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription {
          id
          callbackUrl
          topic
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  
  // Try customers/data_request
  try {
    const response = await fetch(
      `https://${shop}/admin/api/2024-04/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: mutation,
          variables: {
            topic: 'CUSTOMERS_DATA_REQUEST',
            webhookSubscription: {
              callbackUrl: WEBHOOK_URL,
              format: 'JSON'
            }
          }
        })
      }
    );
    
    const data = await response.json();
    console.log('GraphQL Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.log(`❌ GraphQL Error: ${error.message}`);
  }
}

async function main() {
  console.log('🚀 Attempting to Register Compliance Webhooks via API');
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);
  console.log('⚠️  Note: Compliance webhooks typically MUST be registered via Partner Dashboard');
  console.log('   This script attempts API methods, but they may not work.\n');
  
  const { shop, accessToken } = await getAccessTokenFromDB();
  console.log(`Using shop: ${shop}\n`);
  
  await tryRESTAPI(shop, accessToken);
  await tryGraphQL(shop, accessToken);
  
  console.log('\n📝 Conclusion:');
  console.log('   If both methods failed, compliance webhooks MUST be registered via Partner Dashboard');
  console.log('   Go to: https://partners.shopify.com → Your App → App setup → Webhooks');
  console.log('   Or look for: Compliance webhooks section');
}

main().catch(console.error).finally(() => {
  mongoose.connection.close().catch(() => {});
});

