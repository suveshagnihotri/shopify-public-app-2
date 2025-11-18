// Get Access Token from MongoDB and Register Compliance Webhooks
// Usage: node get-token-and-register-webhooks.js

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/shopify_app';
const WEBHOOK_URL = 'https://store-app.peeq.co.in/webhooks';
const API_VERSION = '2024-04';

// Mandatory compliance webhooks
const COMPLIANCE_WEBHOOKS = [
  {
    topic: 'customers/data_request',
    description: 'Customer requests their data (GDPR)'
  },
  {
    topic: 'customers/redact',
    description: 'Customer requests data deletion (GDPR)'
  },
  {
    topic: 'shop/redact',
    description: 'Shop requests data deletion (GDPR)'
  }
];

async function getAccessTokenFromDB() {
  try {
    console.log('📦 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const Store = mongoose.model('Store', new mongoose.Schema({}, { strict: false }), 'stores');
    
    // Get the first active store
    const store = await Store.findOne({ isActive: true }).lean();
    
    if (!store) {
      console.error('❌ No active store found in database');
      console.log('\n💡 To get an access token:');
      console.log('   1. Install your app on a test shop:');
      console.log('      https://store-app.peeq.co.in/auth?shop=YOUR_SHOP.myshopify.com');
      console.log('   2. Complete the OAuth flow');
      console.log('   3. Run this script again');
      process.exit(1);
    }

    const shop = store.shop;
    const accessToken = store.accessToken;

    if (!accessToken) {
      console.error('❌ No access token found for store:', shop);
      process.exit(1);
    }

    console.log(`✅ Found store: ${shop}`);
    console.log(`✅ Access token retrieved`);
    
    await mongoose.disconnect();
    
    return { shop, accessToken };
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error.message);
    console.log('\n💡 Make sure:');
    console.log('   1. MONGODB_URI is set in .env file');
    console.log('   2. MongoDB is accessible');
    console.log('   3. Store data exists in database');
    process.exit(1);
  }
}

async function registerWebhook(shop, accessToken, topic, description) {
  try {
    console.log(`\n📋 Registering: ${topic}`);
    console.log(`   ${description}`);
    
    const response = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/webhooks.json`,
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
      console.log(`✅ Successfully registered: ${topic}`);
      console.log(`   Webhook ID: ${data.webhook.id}`);
      console.log(`   URL: ${data.webhook.address}`);
      return data.webhook;
    } else if (response.status === 422) {
      // Webhook might already exist or topic not found
      const errorMsg = data?.errors?.address?.[0] || 
                      data?.errors?.topic?.[0] || 
                      data?.errors || 
                      'Validation error';
      console.log(`⚠️  ${topic}: ${errorMsg}`);
      
      // Check if it's a "topic not found" error (compliance webhooks)
      if (JSON.stringify(errorMsg).includes('Could not find the webhook topic')) {
        console.log(`   ⚠️  Note: Compliance webhooks may need to be registered via Partner Dashboard`);
        console.log(`   💡 Go to: Partner Dashboard → Your App → App setup → Webhooks`);
      }
      
      // Try to find existing webhook
      try {
        const listResponse = await fetch(
          `https://${shop}/admin/api/${API_VERSION}/webhooks.json?topic=${topic}`,
          {
            headers: {
              'X-Shopify-Access-Token': accessToken
            }
          }
        );
        
        const listData = await listResponse.json();
        if (listData.webhooks && listData.webhooks.length > 0) {
          const existing = listData.webhooks.find(w => w.topic === topic);
          if (existing) {
            console.log(`   ℹ️  Webhook already exists (ID: ${existing.id})`);
            return existing;
          }
        }
      } catch (listError) {
        // Ignore list errors
      }
    } else {
      console.error(`❌ Failed to register ${topic}:`, data || response.statusText);
    }
    return null;
  } catch (error) {
    console.error(`❌ Error registering ${topic}:`, error.message);
    return null;
  }
}

async function listExistingWebhooks(shop, accessToken) {
  try {
    const response = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/webhooks.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken
        }
      }
    );
    
    const data = await response.json();
    
    console.log('\n📋 Existing webhooks:');
    if (data.webhooks && data.webhooks.length > 0) {
      const complianceWebhooks = data.webhooks.filter(w => 
        COMPLIANCE_WEBHOOKS.some(cw => cw.topic === w.topic)
      );
      
      if (complianceWebhooks.length > 0) {
        complianceWebhooks.forEach(webhook => {
          console.log(`   ✅ ${webhook.topic}: ${webhook.address} (ID: ${webhook.id})`);
        });
      } else {
        console.log('   ⚠️  No compliance webhooks found');
      }
    } else {
      console.log('   No webhooks found');
    }
    return data.webhooks || [];
  } catch (error) {
    console.error('❌ Failed to list webhooks:', error.message);
    return [];
  }
}

async function main() {
  console.log('🚀 Registering Mandatory Compliance Webhooks');
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);
  
  // Get access token from MongoDB
  const { shop, accessToken } = await getAccessTokenFromDB();
  
  console.log(`\n📝 Using shop: ${shop}`);
  
  // List existing webhooks
  await listExistingWebhooks(shop, accessToken);
  
  // Register mandatory compliance webhooks
  console.log('\n📝 Registering compliance webhooks...');
  const results = [];
  
  for (const webhook of COMPLIANCE_WEBHOOKS) {
    const result = await registerWebhook(shop, accessToken, webhook.topic, webhook.description);
    results.push({ topic: webhook.topic, success: !!result });
    await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit protection
  }
  
  // Summary
  console.log('\n📊 Summary:');
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`   ✅ Successfully registered: ${successful}/${COMPLIANCE_WEBHOOKS.length}`);
  if (failed > 0) {
    console.log(`   ⚠️  Failed or already exists: ${failed}/${COMPLIANCE_WEBHOOKS.length}`);
  }
  
  console.log('\n📋 Final webhook list:');
  await listExistingWebhooks(shop, accessToken);
  
  console.log('\n✅ Compliance webhook registration complete!');
  console.log('\n📝 Next steps:');
  console.log('   1. Verify webhooks in Partner Dashboard → App setup → Webhooks');
  console.log('   2. Test webhook endpoint: curl -X POST https://store-app.peeq.co.in/webhooks');
  console.log('   3. Re-run validation checks in Partner Dashboard');
}

// Run
main().catch(console.error).finally(() => {
  mongoose.connection.close().catch(() => {});
});

