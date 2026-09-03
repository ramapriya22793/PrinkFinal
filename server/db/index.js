const { connectDB, MONGODB_URI } = require('./connection');
const usersDB = require('./users.db');
const ordersDB = require('./orders.db');
const productsDB = require('./products.db');
const skusDB = require('./skus.db');
const designsDB = require('./designs.db');
const templatesDB = require('./templates.db');
const settingsDB = require('./settings.db');
const notificationsDB = require('./notifications.db');
const analyticsDB = require('./analytics.db');

module.exports = {
  connectDB,
  MONGODB_URI,
  ...usersDB,
  ...ordersDB,
  ...productsDB,
  ...skusDB,
  ...designsDB,
  ...templatesDB,
  ...settingsDB,
  ...notificationsDB,
  ...analyticsDB
};
