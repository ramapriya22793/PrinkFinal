const Template = require('../models/Template');

async function getTemplates() {
  return await Template.find({}).lean();
}

async function getTemplateById(id) {
  return await Template.findOne({ id }).lean();
}

async function saveTemplate(templateData) {
  const id = templateData.id || 'tpl_' + Date.now();
  return await Template.findOneAndUpdate(
    { id },
    { ...templateData, id },
    { upsert: true, new: true }
  ).lean();
}

async function deleteTemplate(id) {
  return await Template.deleteOne({ id });
}

module.exports = {
  getTemplates,
  getTemplateById,
  saveTemplate,
  deleteTemplate
};
