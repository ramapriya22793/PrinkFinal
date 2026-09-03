const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error('MONGODB_URI is not set. Configure server/.env before running this script.');
  process.exit(1);
}

async function seedCustomers() {
  const conn = await mongoose.createConnection(URI).asPromise();
  console.log('Connected to MongoDB.');

  const db = conn.db;

  const names = ['Aarav', 'Vihaan', 'Vivaan', 'Ananya', 'Diya', 'Advik', 'Kabir', 'Anaya', 'Aaradhya', 'Ojas', 'Rohan', 'Amit', 'Neha', 'Pooja', 'Rahul', 'Sneha', 'Karan', 'Priya', 'Vikram', 'Meera'];
  const lastNames = ['Sharma', 'Verma', 'Gupta', 'Malhotra', 'Singh', 'Patel', 'Reddy', 'Nair', 'Menon', 'Iyer', 'Joshi', 'Bose', 'Das', 'Roy', 'Kapoor'];
  const cities = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Ahmedabad', 'Chennai', 'Kolkata', 'Surat', 'Pune', 'Jaipur'];
  const states = ['Maharashtra', 'Delhi', 'Karnataka', 'Telangana', 'Gujarat', 'Tamil Nadu', 'West Bengal', 'Gujarat', 'Maharashtra', 'Rajasthan'];

  const customers = [];
  const users = [];

  const passwordHash = bcrypt.hashSync('password123', 10);

  for (let i = 0; i < 50; i++) {
    const firstName = names[Math.floor(Math.random() * names.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const cityIdx = Math.floor(Math.random() * cities.length);
    const email = `customer${i + 1}@example.com`;
    const phone = `+9198765${String(40000 + i).padStart(5, '0')}`;

    const customer = {
      _id: new mongoose.Types.ObjectId(),
      shopifyCustomerId: `gid://shopify/Customer/${1000000000 + i}`,
      firstName,
      lastName,
      email,
      phone,
      totalOrders: Math.floor(Math.random() * 5) + 1,
      totalSpent: Math.floor(Math.random() * 10000) + 500,
      defaultAddress: `${Math.floor(Math.random() * 100) + 1}, Main Road`,
      city: cities[cityIdx],
      state: states[cityIdx],
      country: 'India',
      postalCode: `4000${String(i).padStart(2, '0')}`,
      createdAt: new Date(Date.now() - Math.floor(Math.random() * 10000000000))
    };
    customers.push(customer);

    // Create the 5 specific login-capable users in the `users` collection
    if (i < 5) {
      users.push({
        id: `usr_seed_${i}`,
        email: email,
        passwordHash: passwordHash,
        role: 'customer',
        name: `${firstName} ${lastName}`,
        phone: phone,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
  }

  // Insert customers
  const customersCollection = db.collection('customers');
  await customersCollection.deleteMany({});
  await customersCollection.insertMany(customers);
  console.log(`Inserted ${customers.length} customers into 'customers' collection.`);

  // Insert the 5 users into existing users collection so they can log in
  const usersCollection = db.collection('users');
  for (const user of users) {
    await usersCollection.updateOne({ email: user.email }, { $set: user }, { upsert: true });
  }
  console.log(`Inserted 5 login-capable customers into 'users' collection with password 'password123'. Emails: customer1@example.com to customer5@example.com`);
  
  await conn.close();
  return { customers, users };
}

if (require.main === module) {
  seedCustomers().catch(console.error);
}

module.exports = seedCustomers;


