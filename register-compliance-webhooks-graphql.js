// Register Compliance Webhooks via Shopify GraphQL Admin API
// Usage: node register-compliance-webhooks-graphql.js

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/shopify_app';
const WEBHOOK_URL = 'https://store-app.peeq.co.in/webhooks';
const API_VERSION = '2024-04';

// Mandatory compliance webhooks
const COMPLIANCE_WEBHOOKS = [
  {
    topic: 'CUSTOMERS_DATA_REQUEST',
    description: 'Customer requests their data (GDPR)'
  },
  {
    topic: 'CUSTOMERS_REDACT',
    description: 'Customer requests data deletion (GDPR)'
  },
  {
    topic: 'SHOP_REDACT',
    description: 'Shop requests data deletion (GDPR)'
  }
];

async function getAccessTokenFromDB() {
  try {
    console.log('📦 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const Store = mongoose.model('Store', new mongoose.Schema({}, { strict: false }), 'stores');
    
    const store = await Store.findOne({ isActive: true }).lean();
    
    if (!store) {
      console.error('❌ No active store found in database');
      console.log('\n💡 Install your app first:');
      console.log('   https://store-app.peeq.co.in/auth?shop=YOUR_SHOP.myshopify.com');
      process.exit(1);
    }

    const shop = store.shop;
    const accessToken = store.accessToken;

    if (!accessToken) {
      console.error('❌ No access token found');
      process.exit(1);
    }

    console.log(`✅ Found store: ${shop}`);
    await mongoose.disconnect();
    
    return { shop, accessToken };
  } catch (error) {
    console.error('❌ MongoDB error:', error.message);
    process.exit(1);
  }
}

async function registerWebhookGraphQL(shop, accessToken, topicEnum, description) {
  try {
    console.log(`\n📋 Registering: ${topicEnum}`);
    console.log(`   ${description}`);
    
    const mutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            callbackUrl
            format
            topic
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      topic: topicEnum,
      webhookSubscription: {
        callbackUrl: WEBHOOK_URL,
        format: 'JSON'
      }
    };

    const response = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: mutation,
          variables: variables
        })
      }
    );

    const data = await response.json();

    if (data.data?.webhookSubscriptionCreate?.webhookSubscription) {
      const webhook = data.data.webhookSubscriptionCreate.webhookSubscription;
      console.log(`✅ Successfully registered: ${topicEnum}`);
      console.log(`   Webhook ID: ${webhook.id}`);
      console.log(`   URL: ${webhook.callbackUrl}`);
      return webhook;
    } else if (data.data?.webhookSubscriptionCreate?.userErrors?.length > 0) {
      const errors = data.data.webhookSubscriptionCreate.userErrors;
      console.log(`⚠️  ${topicEnum}: ${errors.map(e => e.message).join(', ')}`);
      
      // Check if webhook already exists
      if (errors.some(e => e.message.includes('already exists') || e.message.includes('duplicate'))) {
        console.log(`   ℹ️  Webhook already exists`);
        return { id: 'existing', topic: topicEnum };
      }
    } else {
      console.error(`❌ Failed to register ${topicEnum}:`, data);
    }
    return null;
  } catch (error) {
    console.error(`❌ Error registering ${topicEnum}:`, error.message);
    return null;
  }
}

async function listWebhooksGraphQL(shop, accessToken) {
  try {
    const query = `
      query {
        webhookSubscriptions(first: 50) {
          edges {
            node {
              id
              callbackUrl
              format
              topic
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      }
    );

    const data = await response.json();
    
    if (data.data?.webhookSubscriptions?.edges) {
      const webhooks = data.data.webhookSubscriptions.edges.map(edge => edge.node);
      const complianceWebhooks = webhooks.filter(w => 
        COMPLIANCE_WEBHOOKS.some(cw => {
          const topicName = w.topic.toLowerCase().replace(/_/g, '_');
          return topicName.includes(cw.topic.toLowerCase().replace(/_/g, '_'));
        })
      );
      
      console.log('\n📋 Existing compliance webhooks:');
      if (complianceWebhooks.length > 0) {
        complianceWebhooks.forEach(webhook => {
          console.log(`   ✅ ${webhook.topic}: ${webhook.callbackUrl} (ID: ${webhook.id})`);
        });
      } else {
        console.log('   ⚠️  No compliance webhooks found');
      }
      return webhooks;
    }
    return [];
  } catch (error) {
    console.error('❌ Failed to list webhooks:', error.message);
    return [];
  }
}

async function main() {
  console.log('🚀 Registering Compliance Webhooks via GraphQL API');
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);
  
  // Get access token from MongoDB
  const { shop, accessToken } = await getAccessTokenFromDB();
  
  console.log(`\n📝 Using shop: ${shop}`);
  
  // List existing webhooks
  await listWebhooksGraphQL(shop, accessToken);
  
  // Register compliance webhooks
  console.log('\n📝 Registering compliance webhooks via GraphQL...');
  const results = [];
  
  for (const webhook of COMPLIANCE_WEBHOOKS) {
    const result = await registerWebhookGraphQL(shop, accessToken, webhook.topic, webhook.description);
    results.push({ topic: webhook.topic, success: !!result });
    await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit
  }
  
  // Summary
  console.log('\n📊 Summary:');
  const successful = results.filter(r => r.success).length;
  console.log(`   ✅ Successfully registered: ${successful}/${COMPLIANCE_WEBHOOKS.length}`);
  
  console.log('\n📋 Final webhook list:');
  await listWebhooksGraphQL(shop, accessToken);
  
  console.log('\n✅ Registration complete!');
  console.log('\n📝 Note: If GraphQL fails, compliance webhooks MUST be registered via Partner Dashboard');
  console.log('   Go to: Partner Dashboard → Your App → App setup → Webhooks');
}

main().catch(console.error).finally(() => {
  mongoose.connection.close().catch(() => {});
});

