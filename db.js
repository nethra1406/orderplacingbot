// db
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("❌ MONGODB_URI is not defined in your .env file");
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let cachedDB = null;

// ✅ Connect and cache the database instance
async function connectDB() {
  if (cachedDB) return cachedDB;
  await client.connect();
  console.log("✅ Connected to MongoDB");
  cachedDB = client.db("whatsappBot");
  return cachedDB;
}

// ✅ Save a new order
async function saveOrder(orderData) {
  const db = await connectDB();
  const collection = db.collection("orders");
  await collection.insertOne(orderData);
  console.log("📦 Order saved");
}

// ✅ Assign a vendor to an order
async function assignVendorToOrder(orderId, vendorPhone) {
  const db = await connectDB();
  const collection = db.collection("orders");

  const result = await collection.updateOne(
    { orderId },
    {
      $set: {
        vendorId: vendorPhone,
        status: "assigned",
        assignedAt: new Date()
      }
    }
  );

  if (result.modifiedCount) {
    console.log(`✅ Vendor assigned to ${orderId}`);
  } else {
    console.warn(`⚠️ Order ID ${orderId} not found`);
  }
}

// ✅ Save vendor info if not already exists
async function saveVendor(vendorPhone) {
  const db = await connectDB();
  const collection = db.collection("vendors");

  const exists = await collection.findOne({ phone: vendorPhone });
  if (!exists) {
    await collection.insertOne({
      phone: vendorPhone,
      assignedOrders: [],
      createdAt: new Date()
    });
    console.log(`✅ New vendor added: ${vendorPhone}`);
  }
}

// ✅ Link order ID to a vendor’s assigned orders list
async function linkOrderToVendor(orderId, vendorPhone) {
  const db = await connectDB();
  const collection = db.collection("vendors");

  await collection.updateOne(
    { phone: vendorPhone },
    { $addToSet: { assignedOrders: orderId } }
  );
  console.log(`🔗 Linked order ${orderId} to vendor ${vendorPhone}`);
}

// ✅ Retrieve an order by orderId
async function getOrderById(orderId) {
  const db = await connectDB();
  const collection = db.collection("orders");
  return await collection.findOne({ orderId });
}

module.exports = {
  connectDB,
  saveOrder,
  assignVendorToOrder,
  saveVendor,
  linkOrderToVendor,
  getOrderById
};
