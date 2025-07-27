// db.js
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('❌ MONGODB_URI is missing in .env');

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let cachedDB = null;

// ✅ Connect to MongoDB and reuse the DB instance
async function connectDB() {
  if (cachedDB) return cachedDB;
  await client.connect();
  console.log('✅ Connected to MongoDB');
  cachedDB = client.db('whatsappBot');
  return cachedDB;
}

// ✅ Save an order
async function saveOrder(orderData) {
  const db = await connectDB();
  const orders = db.collection('orders');
  await orders.insertOne(orderData);
  console.log('📦 Order saved to DB');
}

// ✅ Retrieve order by ID (optional, used in vendor flow or status checks)
async function getOrderById(orderId) {
  const db = await connectDB();
  const orders = db.collection('orders');
  return await orders.findOne({ orderId });
}

module.exports = {
  connectDB,
  saveOrder,
  getOrderById
};
