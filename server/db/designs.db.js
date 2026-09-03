const Design = require('../models/Design');

async function getDesigns(userId) {
  const query = userId ? { userId } : {};
  return await Design.find(query).sort({ updatedAt: -1 }).lean();
}

async function getDesignById(id) {
  return await Design.findOne({ id }).lean();
}

async function saveDesign(designData) {
  const id = designData.id || 'des_' + Date.now();
  return await Design.findOneAndUpdate(
    { id },
    { ...designData, id },
    { upsert: true, new: true }
  ).lean();
}

async function deleteDesign(id) {
  return await Design.deleteOne({ id });
}

module.exports = {
  getDesigns,
  getDesignById,
  saveDesign,
  deleteDesign
};
