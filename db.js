// db.js
require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('❌ MONGODB_URI is missing in your .env file');

const client = new MongoClient(uri);
let db;

async function connectDB() {
    if (db) return db;
    try {
        await client.connect();
        db = client.db('whatsappBot');
        // Create a 2dsphere index on the vendor collection for geospatial queries
        await db.collection('vendors').createIndex({ location: "2dsphere" });
        console.log('✅ Connected to MongoDB and ensured indexes.');
        return db;
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB', error);
        process.exit(1);
    }
}

// Seed the database with some proxy vendors and delivery partners
async function seedDatabase() {
    if (!db) await connectDB();
    const vendorsCollection = db.collection('vendors');
    const dpsCollection = db.collection('deliveryPartners');

    if (await vendorsCollection.countDocuments() === 0) {
        console.log('Seeding proxy vendors...');
        await vendorsCollection.insertMany([
            // Location for Pattabiram, Chennai
            { name: "Pattabiram Kitchen", phone: process.env.VENDOR_PHONE_1, location: { type: "Point", coordinates: [80.113, 13.093] } },
            // Add another proxy vendor if you want
        ]);
    }

    if (await dpsCollection.countDocuments() === 0) {
        console.log('Seeding proxy delivery partners...');
        await dpsCollection.insertOne(
             { name: "Ravi Delivery", phone: process.env.DELIVERY_PARTNER_PHONE, available: true }
        );
    }
}


async function findNearestVendor(coordinates) {
    if (!db) await connectDB();
    // Coordinates are [longitude, latitude]
    return await db.collection('vendors').findOne({
        location: {
            $near: {
                $geometry: {
                    type: "Point",
                    coordinates: coordinates
                },
                $maxDistance: 5000 // Find vendors within a 5km radius
            }
        }
    });
}

async function findAvailableDeliveryPartner() {
    if (!db) await connectDB();
    return await db.collection('deliveryPartners').findOne({ available: true });
}

async function getOrder(orderId) {
    if (!db) await connectDB();
    return await db.collection('orders').findOne({ orderId });
}

async function saveOrUpdateOrder(orderData) {
    if (!db) await connectDB();
    await db.collection('orders').updateOne(
        { orderId: orderData.orderId },
        { $set: orderData },
        { upsert: true }
    );
    console.log(`📦 Order ${orderData.orderId} saved/updated in DB`);
}


module.exports = {
    connectDB,
    seedDatabase,
    saveOrUpdateOrder,
    getOrder,
    findNearestVendor,
    findAvailableDeliveryPartner,
};