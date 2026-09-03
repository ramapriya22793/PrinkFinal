const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);
const SkuMappingSchema = new mongoose.Schema({}, { strict: false });
const SkuMapping = mongoose.model('SkuMapping', SkuMappingSchema);
SkuMapping.deleteMany({}).then(() => { console.log('cleared'); process.exit(0); });
