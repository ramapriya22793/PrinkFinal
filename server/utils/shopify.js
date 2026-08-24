const db = require('../db');

/**
 * Helper to fetch products from Shopify Admin API and upsert them in MongoDB.
 * Falls back to mock data if credentials are not configured.
 */
async function syncProductsFromShopify() {
  const settings = await db.getSettings();
  const store = settings.shopifyStore || process.env.SHOPIFY_STORE;
  const token = settings.shopifyAccessToken || process.env.SHOPIFY_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || '2026-04';

  const isConfigured = token && token !== 'your_admin_api_access_token';

  if (!isConfigured) {
    console.log('[SHOPIFY SYNC] Using mock products (Shopify credentials not set).');
    
    // Seed/Upsert a few mock products from Shopify
    const mockProducts = [
      {
        shopifyProductId: 'shp_prod_1',
        title: 'Classic Ceramic Mug 11oz',
        handle: 'classic-ceramic-mug-11oz',
        productType: 'mug',
        variants: [{ id: 'v1', title: 'Default Title', price: '12.99', sku: 'MUG-11OZ-CL' }],
        images: ['https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?q=80&w=300']
      },
      {
        shopifyProductId: 'shp_prod_2',
        title: 'Stretch Canvas Print 12x16',
        handle: 'stretch-canvas-print-12x16',
        productType: 'canvas',
        variants: [{ id: 'v2', title: 'Standard', price: '34.99', sku: 'CANVAS-12X16-ST' }],
        images: ['https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?q=80&w=300']
      },
      {
        shopifyProductId: 'shp_prod_3',
        title: 'Premium Photo Frame 8x10',
        handle: 'premium-photo-frame-8x10',
        productType: 'frame',
        variants: [{ id: 'v3', title: 'Black Wood', price: '24.99', sku: 'FRAME-8X10-BK' }],
        images: ['https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=300']
      }
    ];

    for (const p of mockProducts) {
      await db.upsertProduct(p);
    }
    return await db.getProducts();
  }

  try {
    const url = `https://${store}/admin/api/${version}/products.json`;
    console.log(`[SHOPIFY SYNC] Fetching products from ${url}`);
    
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Shopify API responded with status ${res.status}`);
    }

    const data = await res.json();
    const syncedProducts = [];

    if (data.products && Array.isArray(data.products)) {
      for (const p of data.products) {
        let pType = 'canvas'; // default
        const titleLower = p.title.toLowerCase();
        if (titleLower.includes('mug')) pType = 'mug';
        else if (titleLower.includes('frame')) pType = 'frame';
        else if (titleLower.includes('calendar')) pType = 'calendar';
        else if (titleLower.includes('book')) pType = 'photobook';

        const mappedProduct = {
          shopifyProductId: String(p.id),
          title: p.title,
          handle: p.handle,
          productType: pType,
          variants: (p.variants || []).map(v => ({
            id: String(v.id),
            title: v.title,
            price: v.price,
            sku: v.sku
          })),
          images: (p.images || []).map(i => i.src)
        };

        const upserted = await db.upsertProduct(mappedProduct);
        syncedProducts.push(upserted);
      }
    }

    return syncedProducts;
  } catch (err) {
    console.error('[SHOPIFY SYNC ERROR]', err.message);
    if (isConfigured) {
      throw err;
    }
    return await db.getProducts();
  }
}

/**
 * Helper to fetch orders from Shopify Admin API and sync them locally.
 * Falls back to database orders if credentials are not configured.
 */
async function syncOrdersFromShopify() {
  const settings = await db.getSettings();
  const store = settings.shopifyStore || process.env.SHOPIFY_STORE;
  const token = settings.shopifyAccessToken || process.env.SHOPIFY_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || '2026-04';

  const isConfigured = token && token !== 'your_admin_api_access_token';

  if (!isConfigured) {
    console.log('[SHOPIFY SYNC] Shopify Admin API credentials not set. Orders synced from MongoDB.');
    return await db.getOrders();
  }

  try {
    const url = `https://${store}/admin/api/${version}/orders.json?status=any&limit=50`;
    console.log(`[SHOPIFY SYNC] Fetching orders from ${url}`);

    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Shopify API responded with status ${res.status}`);
    }

    const data = await res.json();
    const syncedOrders = [];

    if (data.orders && Array.isArray(data.orders)) {
      for (const o of data.orders) {
        // Check if order already exists in our db
        let localOrder = await db.getOrderByShopifyId(String(o.id));
        if (!localOrder) {
          // Map Shopify order to Prink Order Schema
          let customerName = 'Shopify Customer';
          let phone = '+91 99887 76655';
          if (o.customer) {
            customerName = `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() || customerName;
            phone = o.customer.phone || o.customer.default_address?.phone || phone;
          }

          let productTitle = 'Personalized Canvas Print';
          let productType = 'canvas';
          if (o.line_items && o.line_items.length > 0) {
            const item = o.line_items[0];
            productTitle = item.title || productTitle;

            const titleLower = productTitle.toLowerCase();
            if (titleLower.includes('mug')) productType = 'mug';
            else if (titleLower.includes('frame')) productType = 'frame';
            else if (titleLower.includes('calendar')) productType = 'calendar';
            else if (titleLower.includes('book')) productType = 'photobook';
          }

          const newOrder = {
            id: o.name || `#${o.order_number || o.id}`,
            shopifyId: String(o.id),
            customer: customerName,
            product: productTitle,
            productType: productType,
            dpi: 'No Image',
            dpiStatus: 'none',
            uploadStatus: 'pending',
            date: new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            phone: phone
          };

          const created = await db.createOrder(newOrder);
          syncedOrders.push(created);
        } else {
          syncedOrders.push(localOrder);
        }
      }
    }

    return await db.getOrders();
  } catch (err) {
    console.error('[SHOPIFY ORDERS SYNC ERROR]', err.message);
    if (isConfigured) {
      throw err;
    }
    return await db.getOrders();
  }
}

/**
 * Helper to fetch orders for a specific customer from Shopify Admin API and sync them locally.
 */
async function syncCustomerOrdersFromShopify(customerId) {
  const settings = await db.getSettings();
  const store = settings.shopifyStore || process.env.SHOPIFY_STORE;
  const token = settings.shopifyAccessToken || process.env.SHOPIFY_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || '2026-04';

  const isConfigured = token && token !== 'your_admin_api_access_token';

  if (!isConfigured) {
    console.log('[SHOPIFY SYNC] Shopify Admin API credentials not set. Returning local orders.');
    return await db.getOrders();
  }

  try {
    const numericId = customerId.includes('gid://') ? customerId.split('/').pop() : customerId;
    const url = `https://${store}/admin/api/${version}/orders.json?customer_id=${numericId}&status=any`;
    console.log(`[SHOPIFY SYNC] Fetching specific customer orders from ${url}`);

    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Shopify API responded with status ${res.status}`);
    }

    const data = await res.json();
    const syncedOrders = [];

    if (data.orders && Array.isArray(data.orders)) {
      for (const o of data.orders) {
        let customerName = 'Shopify Customer';
        let phone = '+91 99887 76655';
        if (o.customer) {
          customerName = `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() || customerName;
          phone = o.customer.phone || o.customer.default_address?.phone || phone;
        }

        const dateFormatted = new Date(o.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });

        // Split Shopify Order by line items
        const lineItemsList = o.line_items || [];
        for (const item of lineItemsList) {
          const portalOrderId = `${o.name || '#' + o.order_number}-${item.id}`;
          
          let pType = 'canvas';
          const titleLower = item.title.toLowerCase();
          if (titleLower.includes('mug')) pType = 'mug';
          else if (titleLower.includes('frame')) pType = 'frame';
          else if (titleLower.includes('calendar')) pType = 'calendar';
          else if (titleLower.includes('book')) pType = 'photobook';

          // Check if this sub-order already exists in our db
          let localOrder = await db.getOrderById(portalOrderId);
          if (!localOrder) {
            const newOrder = {
              id: portalOrderId,
              shopifyId: String(o.id),
              customer: customerName,
              product: item.title,
              productType: pType,
              dpi: 'No Image',
              dpiStatus: 'none',
              uploadStatus: 'pending',
              date: dateFormatted,
              phone: phone,
              email: o.email || o.customer?.email || '',
              variant: item.variant_title || '',
              sku: item.sku || '',
              quantity: item.quantity || 1,
              paymentStatus: o.financial_status || 'pending',
              fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
              shopifyCustomerId: o.customer ? String(o.customer.id) : ''
            };
            const created = await db.createOrder(newOrder);
            syncedOrders.push(created);
          } else {
            // Update order status/fields
            const updates = {
              variant: item.variant_title || localOrder.variant || '',
              sku: item.sku || localOrder.sku || '',
              quantity: item.quantity || localOrder.quantity || 1,
              paymentStatus: o.financial_status || localOrder.paymentStatus || 'pending',
              fulfillmentStatus: o.fulfillment_status || localOrder.fulfillmentStatus || 'unfulfilled',
              shopifyCustomerId: o.customer ? String(o.customer.id) : localOrder.shopifyCustomerId || ''
            };
            const updated = await db.updateOrder(localOrder.id, updates);
            syncedOrders.push(updated);
          }
        }
      }
    }

    return syncedOrders;
  } catch (err) {
    console.error('[SHOPIFY CUSTOMER ORDERS SYNC ERROR]', err.message);
    return [];
  }
}

module.exports = {
  syncProductsFromShopify,
  syncOrdersFromShopify,
  syncCustomerOrdersFromShopify
};
