const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'laundryBot';

let client;
let db;

// Connect to MongoDB
async function connectDB() {
  if (db) return db; // Return existing connection if available
  try {
    client = new MongoClient(MONGODB_URI);
    
    await client.connect();
    db = client.db(DB_NAME);
    
    await createIndexes();
    
    console.log('✅ Connected to MongoDB successfully');
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

// Create database indexes
async function createIndexes() {
  try {
    await db.collection('orders').createIndex({ orderNumber: 1 }, { unique: true });
    await db.collection('orders').createIndex({ customerPhone: 1 });
    await db.collection('orders').createIndex({ status: 1 });
    await db.collection('vendors').createIndex({ phoneNumber: 1 }, { unique: true });
    console.log('✅ Database indexes ensured');
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
  }
}

// Save order to database
async function saveOrder(orderData) {
  try {
    if (!db) await connectDB();
    
    const collection = db.collection('orders');
    const order = {
      ...orderData,
      _id: new ObjectId()
    };
    
    const result = await collection.insertOne(order);
    console.log('✅ Order saved:', result.insertedId);
    
    return {
      insertedId: result.insertedId,
      ...order
    };
  } catch (error) {
    console.error('❌ Error saving order:', error);
    throw error;
  }
}

// Get order by ID
async function getOrderById(orderId) {
  try {
    if (!db) await connectDB();
    
    const collection = db.collection('orders');
    const objectId = typeof orderId === 'string' ? new ObjectId(orderId) : orderId;
    return await collection.findOne({ _id: objectId });
  } catch (error) {
    console.error('❌ Error getting order:', error);
    throw error;
  }
}

// Get an order by its unique number
async function getOrderByNumber(orderNumber) {
    try {
      if (!db) await connectDB();
      const collection = db.collection('orders');
      const order = await collection.findOne({ orderNumber });
      return order;
    } catch (error) {
      console.error('❌ Error getting order by number:', error);
      throw error;
    }
}

// Update order status
async function updateOrderStatus(orderId, status, additionalData = {}) {
  try {
    if (!db) await connectDB();
    
    const collection = db.collection('orders');
    const objectId = typeof orderId === 'string' ? new ObjectId(orderId) : orderId;
    
    const updateData = {
      status,
      updatedAt: new Date(),
      ...additionalData
    };
    
    const result = await collection.updateOne(
      { _id: objectId },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      throw new Error('Order not found for update');
    }
    
    console.log('✅ Order status updated:', { orderId: objectId, status });
    return result;
  } catch (error) {
    console.error('❌ Error updating order status:', error);
    throw error;
  }
}

// Assign vendor to order
async function assignVendorToOrder(orderId, vendorPhone) {
    try {
      const result = await updateOrderStatus(orderId, 'pending_vendor_confirmation', {
        vendorPhone,
        assignedAt: new Date()
      });
      console.log('✅ Vendor assigned to order:', { orderId, vendorPhone });
      return result;
    } catch (error) {
      console.error('❌ Error assigning vendor:', error);
      throw error;
    }
}

// NEW: Function to check if a phone number belongs to a vendor
async function getVendorByPhone(phoneNumber) {
  const db = await connectDB();
  return await db.collection('vendors').findOne({ phoneNumber });
}

// NEW: Function to get a user and check if they are verified
async function getUserByPhone(phoneNumber) {
  const db = await connectDB();
  return await db.collection('users').findOne({ phoneNumber });
}

// NEW: Function to close the database connection (for the seed script)
async function closeDB() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('MongoDB connection closed.');
    }
}

// NEW: Helper function to get the DB instance (for the track order feature)
const getDB = () => db;


// Export all functions
module.exports = {
  connectDB,
  saveOrder,
  getOrderById,
  getOrderByNumber,
  updateOrderStatus,
  assignVendorToOrder,
  getVendorByPhone,   // <-- ADDED
  getUserByPhone,     // <-- ADDED
  closeDB,            // <-- ADDED
  getDB               // <-- ADDED
};