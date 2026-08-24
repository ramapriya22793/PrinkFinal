const axios = require('axios');
const shopifyConfig = require('../config/shopify.config');

/**
 * Reusable Axios client configured for Shopify Admin REST API.
 * Features rate limit auto-retry (429 handling) and authorization injection.
 */

// Helper function to sleep for a specific time
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const createShopifyClient = (shopDomain, accessToken) => {
  const storeUrl = shopDomain || shopifyConfig.store;
  const token = accessToken || shopifyConfig.accessToken;
  const cleanStoreUrl = storeUrl.replace(/https?:\/\//, '');

  const client = axios.create({
    baseURL: `https://${cleanStoreUrl}/admin/api/${shopifyConfig.apiVersion}`,
    timeout: 8000,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });

  // Logging Interceptor for debugging
  client.interceptors.request.use((config) => {
    console.log(`[SHOPIFY API REQUEST] ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
    return config;
  }, (error) => {
    return Promise.reject(error);
  });

  // Rate Limiting and Error Handling Interceptor
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const { config, response } = error;
      
      // If error is rate limited (HTTP 429)
      if (response && response.status === 429) {
        // Shopify returns the wait time in seconds via the 'Retry-After' header (defaulting to 2s if missing)
        const retryAfter = parseFloat(response.headers['retry-after'] || '2') * 1000;
        console.warn(`[SHOPIFY RATE LIMIT] Status 429. Retrying after ${retryAfter}ms...`);
        
        // Track retry attempts
        config.__retryCount = config.__retryCount || 0;
        if (config.__retryCount < 3) {
          config.__retryCount += 1;
          await sleep(retryAfter);
          return client(config); // Retry original request
        }
      }

      // Format custom standard error payload
      if (response) {
        const errorData = response.data;
        const status = response.status;
        console.error(`[SHOPIFY API ERROR] Code ${status}:`, JSON.stringify(errorData));
        
        const customError = new Error(errorData.errors ? JSON.stringify(errorData.errors) : 'Shopify API Error');
        customError.status = status;
        customError.details = errorData;
        return Promise.reject(customError);
      }

      return Promise.reject(error);
    }
  );

  return client;
};

module.exports = {
  createShopifyClient
};
