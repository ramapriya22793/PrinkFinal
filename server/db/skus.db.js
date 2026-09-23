const SKU = require('../models/SKU');

async function getSkuMappings() {
  return await SKU.find({}).lean();
}

async function getSkuByCode(sku) {
  return await SKU.findOne({ sku }).lean();
}

async function saveSkuMapping(skuData) {
  const id = skuData.id || ('sku_' + (skuData.sku ? skuData.sku.toLowerCase().replace(/[^a-z0-9_-]/g, '_') : Date.now()));
  const payload = { ...skuData, id };
  const query = skuData.id ? { $or: [{ id: skuData.id }, { sku: skuData.sku }] } : { sku: skuData.sku };
  return await SKU.findOneAndUpdate(
    query,
    payload,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

async function deleteSkuMapping(sku) {
  return await SKU.deleteOne({ $or: [{ sku }, { id: sku }] });
}

module.exports = {
  getSkuMappings,
  getSkuByCode,
  getSkuMappingBySku: getSkuByCode,
  saveSkuMapping,
  deleteSkuMapping
};
