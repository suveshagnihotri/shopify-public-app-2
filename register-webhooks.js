// Register Mandatory Compliance Webhooks via Shopify Admin API
// Usage: node register-webhooks.js

const axios = require('axios');

// CONFIGURATION - Update these values
const SHOP = process.env.SHOPIFY_SHOP || 'YOUR_SHOP.myshopify.com';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || 'YOUR_ACCESS_TOKEN';
const WEBHOOK_URL = 'https://store-app.peeq.co.in/webhooks';
const API_VERSION = '2024-04';

// Mandatory compliance webhooks
const MANDATORY_WEBHOOKS = [
  'customers/data_request',
  'customers/redact',
  'shop/redact'
];

async function registerWebhook(topic) {
  try {
    console.log(`Registering webhook: ${topic}...`);
    
    const response = await axios.post(
      `https://${SHOP}/admin/api/${API_VERSION}/webhooks.json`,
      {
        webhook: {
          topic: topic,
          address: WEBHOOK_URL,
          format: 'json'
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`✅ Successfully registered: ${topic}`);
    console.log(`   Webhook ID: ${response.data.webhook.id}`);
    return response.data.webhook;
  } catch (error) {
    if (error.response?.status === 422 && error.response?.data?.errors) {
      // Webhook might already exist
      console.log(`⚠️  ${topic}: ${error.response.data.errors.address?.[0] || error.response.data.errors.topic?.[0] || 'Already exists or validation error'}`);
    } else {
      console.error(`❌ Failed to register ${topic}:`, error.response?.data || error.message);
    }
    return null;
  }
}

async function listExistingWebhooks() {
  try {
    const response = await axios.get(
      `https://${SHOP}/admin/api/${API_VERSION}/webhooks.json`,
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN
        }
      }
    );
    
    console.log('\n📋 Existing webhooks:');
    if (response.data.webhooks && response.data.webhooks.length > 0) {
      response.data.webhooks.forEach(webhook => {
        console.log(`   - ${webhook.topic}: ${webhook.address} (ID: ${webhook.id})`);
      });
    } else {
      console.log('   No webhooks found');
    }
    return response.data.webhooks || [];
  } catch (error) {
    console.error('❌ Failed to list webhooks:', error.response?.data || error.message);
    return [];
  }
}

async function registerAll() {
  console.log('🚀 Starting webhook registration...\n');
  console.log(`Shop: ${SHOP}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);
  
  // Check if credentials are set
  if (ACCESS_TOKEN === 'YOUR_ACCESS_TOKEN' || SHOP === 'YOUR_SHOP.myshopify.com') {
    console.error('❌ Error: Please set SHOPIFY_ACCESS_TOKEN and SHOPIFY_SHOP environment variables');
    console.error('\nUsage:');
    console.error('  SHOPIFY_SHOP=your-shop.myshopify.com SHOPIFY_ACCESS_TOKEN=your_token node register-webhooks.js');
    console.error('\nOr create a .env file with:');
    console.error('  SHOPIFY_SHOP=your-shop.myshopify.com');
    console.error('  SHOPIFY_ACCESS_TOKEN=your_token');
    process.exit(1);
  }
  
  // List existing webhooks
  await listExistingWebhooks();
  console.log('\n');
  
  // Register mandatory webhooks
  for (const topic of MANDATORY_WEBHOOKS) {
    await registerWebhook(topic);
    await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit protection
  }
  
  console.log('\n✅ Webhook registration complete!');
  console.log('\n📋 Final webhook list:');
  await listExistingWebhooks();
}

// Run
registerAll().catch(console.error);


