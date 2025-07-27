// db.js
require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) {
    throw new Error('❌ MONGODB_URI is missing in your .env file');
}

const client = new MongoClient(uri);
let db;

/**
 * Connects to the MongoDB database.
 * @returns {Promise<Db>} The database instance.
 */
async function connectDB() {
    if (db) return db;
    try {
        await client.connect();
        db = client.db('whatsappBot');
        console.log('✅ Connected to MongoDB');
        return db;
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB', error);
        process.exit(1); // Exit the process if DB connection fails
    }
}

/**
 * Saves an order document to the 'orders' collection.
 * @param {object} orderData - The order data to save.
 */
async function saveOrder(orderData) {
    if (!db) await connectDB();
    const collection = db.collection('orders');
    await collection.insertOne(orderData);
    console.log(`📦 Order ${orderData.orderId} saved to DB`);
}

/**
 * Retrieves an order by its ID.
 * @param {string} orderId - The ID of the order to find.
 * @returns {Promise<object|null>} The order document or null if not found.
 */
async function getOrderById(orderId) {
    if (!db) await connectDB();
    const collection = db.collection('orders');
    return await collection.findOne({ orderId });
}

module.exports = {
    connectDB,
    saveOrder,
    getOrderById,
};