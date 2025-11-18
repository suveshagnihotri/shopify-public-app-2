// Register Mandatory Compliance Webhooks for Shopify Public App
// Usage: node register-compliance-webhooks.js

const axios = require('axios');

// CONFIGURATION - Update these values
const SHOP = process.env.SHOPIFY_SHOP || 'YOUR_SHOP.myshopify.com';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || 'YOUR_ACCESS_TOKEN';
const WEBHOOK_URL = 'https://store-app.peeq.co.in/webhooks';
const API_VERSION = '2024-04';

// Mandatory compliance webhooks (required for public apps)
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

async function registerWebhook(topic, description) {
  try {
    console.log(`\n📋 Registering: ${topic}`);
    console.log(`   ${description}`);
    
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
    console.log(`   URL: ${response.data.webhook.address}`);
    return response.data.webhook;
  } catch (error) {
    if (error.response?.status === 422) {
      // Webhook might already exist
      const errorMsg = error.response.data?.errors?.address?.[0] || 
                      error.response.data?.errors?.topic?.[0] || 
                      'Validation error';
      console.log(`⚠️  ${topic}: ${errorMsg}`);
      
      // Try to find existing webhook
      try {
        const listResponse = await axios.get(
          `https://${SHOP}/admin/api/${API_VERSION}/webhooks.json?topic=${topic}`,
          {
            headers: {
              'X-Shopify-Access-Token': ACCESS_TOKEN
            }
          }
        );
        
        if (listResponse.data.webhooks && listResponse.data.webhooks.length > 0) {
          const existing = listResponse.data.webhooks.find(w => w.topic === topic);
          if (existing) {
            console.log(`   ℹ️  Webhook already exists (ID: ${existing.id})`);
            return existing;
          }
        }
      } catch (listError) {
        // Ignore list errors
      }
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
      const complianceWebhooks = response.data.webhooks.filter(w => 
        COMPLIANCE_WEBHOOKS.some(cw => cw.topic === w.topic)
      );
      
      if (complianceWebhooks.length > 0) {
        complianceWebhooks.forEach(webhook => {
          console.log(`   ✅ ${webhook.topic}: ${webhook.address} (ID: ${webhook.id})`);
        });
      } else {
        console.log('   ⚠️  No compliance webhooks found');
      }
      
      const otherWebhooks = response.data.webhooks.filter(w => 
        !COMPLIANCE_WEBHOOKS.some(cw => cw.topic === w.topic)
      );
      
      if (otherWebhooks.length > 0) {
        console.log(`\n   Other webhooks (${otherWebhooks.length}):`);
        otherWebhooks.forEach(webhook => {
          console.log(`   - ${webhook.topic}: ${webhook.address}`);
        });
      }
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
  console.log('🚀 Registering Mandatory Compliance Webhooks for Shopify Public App\n');
  console.log(`Shop: ${SHOP}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);
  
  // Check if credentials are set
  if (ACCESS_TOKEN === 'YOUR_ACCESS_TOKEN' || SHOP === 'YOUR_SHOP.myshopify.com') {
    console.error('❌ Error: Please set SHOPIFY_ACCESS_TOKEN and SHOPIFY_SHOP environment variables');
    console.error('\nUsage:');
    console.error('  SHOPIFY_SHOP=your-shop.myshopify.com SHOPIFY_ACCESS_TOKEN=your_token node register-compliance-webhooks.js');
    console.error('\nOr create a .env file with:');
    console.error('  SHOPIFY_SHOP=your-shop.myshopify.com');
    console.error('  SHOPIFY_ACCESS_TOKEN=your_token');
    process.exit(1);
  }
  
  // List existing webhooks
  await listExistingWebhooks();
  
  // Register mandatory compliance webhooks
  console.log('\n📝 Registering compliance webhooks...');
  const results = [];
  
  for (const webhook of COMPLIANCE_WEBHOOKS) {
    const result = await registerWebhook(webhook.topic, webhook.description);
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
  await listExistingWebhooks();
  
  console.log('\n✅ Compliance webhook registration complete!');
  console.log('\n📝 Next steps:');
  console.log('   1. Verify webhooks in Partner Dashboard → App setup → Webhooks');
  console.log('   2. Test webhook endpoint: curl -X POST https://store-app.peeq.co.in/webhooks');
  console.log('   3. Re-run validation checks in Partner Dashboard');
}

// Run
registerAll().catch(console.error);

