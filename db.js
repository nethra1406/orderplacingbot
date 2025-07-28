const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'laundryBot';

let client;
let db;

// Connect to MongoDB
async function connectDB() {
  try {
    client = new MongoClient(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    await client.connect();
    db = client.db(DB_NAME);
    
    // Create indexes for better performance
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
    // Orders collection indexes
    await db.collection('orders').createIndex({ orderNumber: 1 }, { unique: true });
    await db.collection('orders').createIndex({ customerPhone: 1 });
    await db.collection('orders').createIndex({ status: 1 });
    await db.collection('orders').createIndex({ createdAt: -1 });
    await db.collection('orders').createIndex({ vendorId: 1 });
    
    // Vendors collection indexes
    await db.collection('vendors').createIndex({ phoneNumber: 1 }, { unique: true });
    await db.collection('vendors').createIndex({ isActive: 1 });
    await db.collection('vendors').createIndex({ location: 1 });
    
    // Delivery partners collection indexes
    await db.collection('deliveryPartners').createIndex({ phoneNumber: 1 }, { unique: true });
    await db.collection('deliveryPartners').createIndex({ isActive: 1 });
    
    // Users collection indexes
    await db.collection('users').createIndex({ phoneNumber: 1 }, { unique: true });
    
    console.log('✅ Database indexes created successfully');
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
  }
}

// Save order to database
async function saveOrder(orderData) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('orders');
    const order = {
      ...orderData,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: orderData.status || 'pending',
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
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('orders');
    const objectId = typeof orderId === 'string' ? new ObjectId(orderId) : orderId;
    const order = await collection.findOne({ _id: objectId });
    
    return order;
  } catch (error) {
    console.error('❌ Error getting order:', error);
    throw error;
  }
}

// Get order by order number
async function getOrderByNumber(orderNumber) {
  try {
    if (!db) {
      await connectDB();
    }
    
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
    if (!db) {
      await connectDB();
    }
    
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
      throw new Error('Order not found');
    }
    
    console.log('✅ Order status updated:', { orderId, status });
    return result;
  } catch (error) {
    console.error('❌ Error updating order status:', error);
    throw error;
  }
}

// Get orders by customer phone
async function getOrdersByCustomer(customerPhone, limit = 10) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('orders');
    const orders = await collection
      .find({ customerPhone })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    
    return orders;
  } catch (error) {
    console.error('❌ Error getting customer orders:', error);
    throw error;
  }
}

// Save vendor information
async function saveVendor(vendorData) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('vendors');
    const vendor = {
      ...vendorData,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true
    };
    
    const result = await collection.insertOne(vendor);
    console.log('✅ Vendor saved:', result.insertedId);
    
    return result;
  } catch (error) {
    console.error('❌ Error saving vendor:', error);
    throw error;
  }
}

// Get vendor by phone number
async function getVendorByPhone(phoneNumber) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('vendors');
    const vendor = await collection.findOne({ phoneNumber });
    
    return vendor;
  } catch (error) {
    console.error('❌ Error getting vendor:', error);
    throw error;
  }
}

// Assign vendor to order
async function assignVendorToOrder(orderId, vendorPhone) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const objectId = typeof orderId === 'string' ? new ObjectId(orderId) : orderId;
    
    const result = await updateOrderStatus(orderId, 'vendor_assigned', {
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

// Link order to vendor (alternative function name)
async function linkOrderToVendor(orderId, vendorPhone) {
  return await assignVendorToOrder(orderId, vendorPhone);
}

// Get active orders for vendor
async function getVendorOrders(vendorPhone, status = null) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('orders');
    const query = { vendorPhone };
    
    if (status) {
      query.status = status;
    }
    
    const orders = await collection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    
    return orders;
  } catch (error) {
    console.error('❌ Error getting vendor orders:', error);
    throw error;
  }
}

// Save user information
async function saveUser(userData) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('users');
    const user = {
      ...userData,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true
    };
    
    const result = await collection.replaceOne(
      { phoneNumber: userData.phoneNumber },
      user,
      { upsert: true }
    );
    
    console.log('✅ User saved:', userData.phoneNumber);
    return result;
  } catch (error) {
    console.error('❌ Error saving user:', error);
    throw error;
  }
}

// Get user by phone number
async function getUserByPhone(phoneNumber) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('users');
    const user = await collection.findOne({ phoneNumber });
    
    return user;
  } catch (error) {
    console.error('❌ Error getting user:', error);
    throw error;
  }
}

// Save delivery partner information
async function saveDeliveryPartner(partnerData) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('deliveryPartners');
    const partner = {
      ...partnerData,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true
    };
    
    const result = await collection.insertOne(partner);
    console.log('✅ Delivery partner saved:', result.insertedId);
    
    return result;
  } catch (error) {
    console.error('❌ Error saving delivery partner:', error);
    throw error;
  }
}

// Get delivery partner by phone
async function getDeliveryPartnerByPhone(phoneNumber) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('deliveryPartners');
    const partner = await collection.findOne({ phoneNumber });
    
    return partner;
  } catch (error) {
    console.error('❌ Error getting delivery partner:', error);
    throw error;
  }
}

// Save feedback
async function saveFeedback(feedbackData) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('feedback');
    const feedback = {
      ...feedbackData,
      createdAt: new Date()
    };
    
    const result = await collection.insertOne(feedback);
    console.log('✅ Feedback saved:', result.insertedId);
    
    // Also update the order with feedback
    if (feedbackData.orderId) {
      await updateOrderStatus(feedbackData.orderId, 'completed', {
        feedback: feedbackData.rating,
        feedbackText: feedbackData.text || null,
        completedAt: new Date()
      });
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error saving feedback:', error);
    throw error;
  }
}

// Get orders statistics
async function getOrdersStats(startDate = null, endDate = null) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('orders');
    const matchStage = {};
    
    if (startDate && endDate) {
      matchStage.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const stats = await collection.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$total' },
          avgOrderValue: { $avg: '$total' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]).toArray();
    
    return stats[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      completedOrders: 0,
      pendingOrders: 0
    };
  } catch (error) {
    console.error('❌ Error getting orders stats:', error);
    throw error;
  }
}

// Get orders by status
async function getOrdersByStatus(status, limit = 50) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('orders');
    const orders = await collection
      .find({ status })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    
    return orders;
  } catch (error) {
    console.error('❌ Error getting orders by status:', error);
    throw error;
  }
}

// Close database connection
async function closeDB() {
  try {
    if (client) {
      await client.close();
      console.log('✅ Database connection closed');
    }
  } catch (error) {
    console.error('❌ Error closing database:', error);
  }
}

// Cleanup old sessions (call periodically)
async function cleanupOldSessions(daysOld = 7) {
  try {
    if (!db) {
      await connectDB();
    }
    
    const collection = db.collection('sessions');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const result = await collection.deleteMany({
      updatedAt: { $lt: cutoffDate }
    });
    
    console.log(`✅ Cleaned up ${result.deletedCount} old sessions`);
    return result;
  } catch (error) {
    console.error('❌ Error cleaning up sessions:', error);
    throw error;
  }
}

// Export all functions
module.exports = {
  connectDB,
  closeDB,
  
  // Order functions
  saveOrder,
  getOrderById,
  getOrderByNumber,
  updateOrderStatus,
  getOrdersByCustomer,
  getOrdersByStatus,
  getOrdersStats,
  
  // Vendor functions
  saveVendor,
  getVendorByPhone,
  assignVendorToOrder,
  linkOrderToVendor,
  getVendorOrders,
  
  // User functions
  saveUser,
  getUserByPhone,
  
  // Delivery partner functions
  saveDeliveryPartner,
  getDeliveryPartnerByPhone,
  
  // Feedback functions
  saveFeedback,
  
  // Utility functions
  cleanupOldSessions,
  
  // Direct database access (use carefully)
  getDB: () => db,
  getClient: () => client
};