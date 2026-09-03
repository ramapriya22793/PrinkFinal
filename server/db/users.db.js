const User = require('../models/User');
const bcrypt = require('bcryptjs');

async function getUsers() {
  return await User.find({}).lean();
}

async function getUserByEmail(email) {
  if (!email) return null;
  return await User.findOne({ email: email.toLowerCase() }).lean();
}

async function getUserByPhone(phone) {
  if (!phone) return null;
  return await User.findOne({ phone }).lean();
}

async function createUser(userData) {
  const user = new User({
    id: userData.id || 'usr_' + Date.now(),
    email: userData.email,
    passwordHash: userData.password ? bcrypt.hashSync(userData.password, 10) : userData.passwordHash,
    role: userData.role || 'customer',
    name: userData.name || '',
    phone: userData.phone || '',
    status: userData.status || 'active'
  });
  await user.save();
  return user.toObject();
}

async function updateUser(id, updates) {
  return await User.findOneAndUpdate({ id }, updates, { new: true }).lean();
}

async function deleteUser(id) {
  return await User.deleteOne({ id });
}

async function updateLastLogin(email) {
  return await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { lastLogin: new Date() },
    { new: true }
  ).lean();
}

module.exports = {
  getUsers,
  getUserByEmail,
  getUserByPhone,
  createUser,
  updateUser,
  deleteUser,
  updateLastLogin
};
