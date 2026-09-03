const Product = require('../models/Product');

async function getProducts() {
  return await Product.find({}).lean();
}

async function getProductById(id) {
  return await Product.findOne({ shopifyProductId: id }).lean();
}

async function upsertProduct(productData) {
  return await Product.findOneAndUpdate(
    { shopifyProductId: productData.shopifyProductId },
    productData,
    { upsert: true, new: true }
  ).lean();
}

async function deleteProduct(id) {
  return await Product.deleteOne({ shopifyProductId: id });
}

module.exports = {
  getProducts,
  getProductById,
  upsertProduct,
  deleteProduct
};
