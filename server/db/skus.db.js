const SKU = require('../models/SKU');

async function getSkuMappings() {
  return await SKU.find({}).lean();
}

async function getSkuByCode(sku) {
  return await SKU.findOne({ sku }).lean();
}

async function saveSkuMapping(skuData) {
  const query = skuData.sku ? { sku: skuData.sku } : { id: skuData.id };
  return await SKU.findOneAndUpdate(
    query,
    skuData,
    { upsert: true, new: true }
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
