require('dotenv').config();
const { MongoClient } = require('mongodb');

// Read your .env variables
const {
  MONGODB_URI,
  DB_NAME,
  VENDOR_PHONE_1,
  DELIVERY_PARTNER_PHONE,
} = process.env;

// Your list of users who are allowed to use the bot
const VERIFIED_USER_PHONES = [
  '919916814517',
  '917358791933',
  '919444631398',
  '919043331484',
  '919710486191',
  '918072462490'
];

const seedDatabase = async () => {
  let client;
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    console.log('🌱 Connected to database for seeding...');

    // Seed Vendor
    const vendorsCollection = db.collection('vendors');
    await vendorsCollection.updateOne(
      { phoneNumber: VENDOR_PHONE_1 },
      { $set: { name: 'Main Vendor', phoneNumber: VENDOR_PHONE_1, isActive: true, createdAt: new Date() } },
      { upsert: true }
    );
    console.log(`✅ Vendor seeded: ${VENDOR_PHONE_1}`);

    // Seed Delivery Partner
    const deliveryPartnersCollection = db.collection('deliveryPartners');
    await deliveryPartnersCollection.updateOne(
      { phoneNumber: DELIVERY_PARTNER_PHONE },
      { $set: { name: 'Main Delivery Partner', phoneNumber: DELIVERY_PARTNER_PHONE, isActive: true, createdAt: new Date() } },
      { upsert: true }
    );
    console.log(`✅ Delivery Partner seeded: ${DELIVERY_PARTNER_PHONE}`);

    // Seed Verified Users
    const usersCollection = db.collection('users');
    for (const phone of VERIFIED_USER_PHONES) {
      await usersCollection.updateOne(
        { phoneNumber: phone },
        { $set: { phoneNumber: phone, isVerified: true, createdAt: new Date() } },
        { upsert: true }
      );
    }
    console.log(`✅ ${VERIFIED_USER_PHONES.length} verified users seeded.`);
    console.log('\n🌿 Database seeding complete!');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed.');
    }
  }
};

seedDatabase();