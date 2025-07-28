require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const {
  saveOrder,
  connectDB,
  assignVendorToOrder,
  saveVendor,
  linkOrderToVendor,
  getOrderById
} = require('./db');

const app = express();
const port = process.env.PORT || 10000;
app.use(bodyParser.json());

// Configuration from environment variables
const {
  PHONE_NUMBER_ID = '662337226973605',
  ACCESS_TOKEN = 'EAAb3dkK6rEMBPA7VqIFNi1QbP3amZAZABpXCOZCOwYzNBma3ZBaVtpd1Eltt5mXB1ZB8hexhAIi6pHw2ccynIjdutaeUshwBC35XuzvJrcTJlUJUZATxdSKRJi54JWAhzcmScauO3QdN3HJvzbCfmpo6TaCxb57HFoLp61qooYljAjj5jx01OIJRAl27fHSk14oXntfJ8Y1RkbIzTZBI73KmFssRTD28ultVoNeJYw5b5J3OLwbUtH252mFLWuPdAZDZD',
  VERIFY_TOKEN = 'my_verify_token',
  MONGODB_URI = 'mongodb+srv://admin:admiN@cluster0.nzat7fd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  DB_NAME = 'laundryBot',
  VENDOR_PHONE_1 = '919043331484',
  DELIVERY_PARTNER_PHONE = '919916814517',
  CATALOG_ID = '1189444639537872'
} = process.env;

// Initialize database connection
connectDB().then(() => {
  console.log('✅ Database connected successfully');
}).catch(err => {
  console.error('❌ Database connection failed:', err);
});

// Session management and configuration
const sessions = {};
const userOrderStatus = {};
const vendors = ['919043331484'];
const verifiedNumbers = [
  '919916814517',
  '917358791933', 
  '919444631398',
  '919043331484',
  '919710486191'
];

// Session states
const SESSION_STATES = {
  INITIAL: 'initial',
  WAITING_FOR_NAME: 'waiting_for_name',
  WAITING_FOR_ADDRESS: 'waiting_for_address',
  WAITING_FOR_PAYMENT: 'waiting_for_payment',
  ORDER_SUMMARY: 'order_summary',
  ORDER_PLACED: 'order_placed',
  VENDOR_CONFIRMATION: 'vendor_confirmation',
  COLLECTION_SCHEDULED: 'collection_scheduled',
  IN_TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
  FEEDBACK: 'feedback'
};

// Utility functions
function getUserSession(phoneNumber) {
  if (!sessions[phoneNumber]) {
    sessions[phoneNumber] = {
      state: SESSION_STATES.INITIAL,
      userData: {},
      orderData: {},
      timestamp: new Date()
    };
  }
  return sessions[phoneNumber];
}

function updateUserSession(phoneNumber, updates) {
  const session = getUserSession(phoneNumber);
  Object.assign(session, updates);
  sessions[phoneNumber] = session;
}

function isVerifiedNumber(phoneNumber) {
  return verifiedNumbers.includes(phoneNumber);
}

// WhatsApp API functions
async function sendInteractiveMessage(to, message, buttons) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: message },
      action: {
        buttons: buttons
      }
    }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: { 
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Interactive message sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending interactive message:', error.response?.data || error.message);
    throw error;
  }
}

async function sendTextMessage(to, message) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message }
  };

  try {
    await axios.post(url, payload, {
      headers: { 
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Text message sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending text message:', error.response?.data || error.message);
  }
}

async function sendCatalog(to) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'catalog_message',
      body: { text: '🧺 Browse our laundry services and select items you need!' },
      action: {
        name: 'catalog_message',
        parameters: {
          catalog_id: CATALOG_ID
        }
      }
    }
  };

  try {
    await axios.post(url, payload, {
      headers: { 
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Catalog sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending catalog:', error.response?.data || error.message);
  }
}

// Message handlers
async function handleWelcomeMessage(phoneNumber) {
  if (!isVerifiedNumber(phoneNumber)) {
    await sendTextMessage(phoneNumber, '❌ Sorry, this service is currently available only for verified numbers. Please contact support for access.');
    return;
  }

  const welcomeMessage = `🙏 Welcome to *Sparkling Clean Laundry*! 

We provide premium laundry services with doorstep pickup and delivery.

How can we assist you today?`;

  const buttons = [
    { type: 'reply', reply: { id: 'order_now', title: '🛍️ Order Now' } },
    { type: 'reply', reply: { id: 'contact_us', title: '📞 Contact Us' } },
    { type: 'reply', reply: { id: 'help', title: '❓ Help' } }
  ];

  await sendInteractiveMessage(phoneNumber, welcomeMessage, buttons);
  updateUserSession(phoneNumber, { state: SESSION_STATES.INITIAL });
}

async function handleOrderNow(phoneNumber) {
  await sendCatalog(phoneNumber);
  
  setTimeout(async () => {
    const message = `Please select items from our catalog above. 

Once you've made your selection, I'll help you complete your order! 📦`;
    
    const buttons = [
      { type: 'reply', reply: { id: 'catalog_done', title: '✅ Done Selecting' } },
      { type: 'reply', reply: { id: 'need_help', title: '❓ Need Help' } }
    ];
    
    await sendInteractiveMessage(phoneNumber, message, buttons);
  }, 3000);
}

async function handleCatalogDone(phoneNumber) {
  const message = `Great! Now let's get your details to process the order.

What's your name? 👤`;
  
  const buttons = [
    { type: 'reply', reply: { id: 'skip_name', title: '⏭️ Skip' } }
  ];
  
  await sendInteractiveMessage(phoneNumber, message, buttons);
  updateUserSession(phoneNumber, { state: SESSION_STATES.WAITING_FOR_NAME });
}

async function handleNameInput(phoneNumber, name) {
  const session = getUserSession(phoneNumber);
  session.userData.name = name === 'skip_name' ? 'Valued Customer' : name;
  
  const message = `Thanks ${session.userData.name}! 

Now, please share your pickup/delivery address 📍`;
  
  const buttons = [
    { type: 'reply', reply: { id: 'share_location', title: '📍 Share Location' } },
    { type: 'reply', reply: { id: 'type_address', title: '✍️ Type Address' } }
  ];
  
  await sendInteractiveMessage(phoneNumber, message, buttons);
  updateUserSession(phoneNumber, { 
    state: SESSION_STATES.WAITING_FOR_ADDRESS,
    userData: session.userData 
  });
}

async function handleAddressInput(phoneNumber, input) {
  const session = getUserSession(phoneNumber);
  
  if (input === 'share_location') {
    session.userData.address = 'Location will be shared';
    await sendTextMessage(phoneNumber, '📍 Please share your location using WhatsApp location feature, or type your address manually.');
    // Don't change state yet, wait for actual location or address
    return;
  } else if (input === 'type_address') {
    await sendTextMessage(phoneNumber, '✍️ Please type your complete pickup/delivery address:');
    return;
  } else {
    // This is the actual address input
    session.userData.address = input;
  }
  
  const message = `Perfect! Address noted: ${session.userData.address}

How would you like to pay? 💳`;
  
  const buttons = [
    { type: 'reply', reply: { id: 'cash', title: '💵 Cash on Delivery' } },
    { type: 'reply', reply: { id: 'upi', title: '📱 UPI Payment' } },
    { type: 'reply', reply: { id: 'card', title: '💳 Card Payment' } }
  ];
  
  await sendInteractiveMessage(phoneNumber, message, buttons);
  updateUserSession(phoneNumber, { 
    state: SESSION_STATES.WAITING_FOR_PAYMENT,
    userData: session.userData 
  });
}

async function handlePaymentMethod(phoneNumber, paymentMethod) {
  const session = getUserSession(phoneNumber);
  session.userData.paymentMethod = paymentMethod;
  
  // Mock order items (in real scenario, fetch from catalog selection)
  // You can modify this to get actual selected items from WhatsApp catalog
  const mockItems = [
    { name: 'Shirt Wash & Iron', quantity: 3, price: 60 },
    { name: 'Jeans Wash', quantity: 2, price: 80 },
    { name: 'Bedsheet Wash', quantity: 1, price: 50 }
  ];
  
  const total = mockItems.reduce((sum, item) => sum + item.price, 0);
  
  session.orderData = {
    items: mockItems,
    total: total,
    paymentMethod: paymentMethod
  };
  
  let itemsList = mockItems.map(item => 
    `• ${item.name} (${item.quantity}x) - ₹${item.price}`
  ).join('\n');
  
  const paymentText = {
    'cash': '💵 Cash on Delivery',
    'upi': '📱 UPI Payment',
    'card': '💳 Card Payment'
  };
  
  const message = `📋 *Order Summary*

${itemsList}

*Total Amount:* ₹${total}
*Payment Method:* ${paymentText[paymentMethod]}
*Customer:* ${session.userData.name}
*Delivery Address:* ${session.userData.address}

Ready to place your order?`;
  
  const buttons = [
    { type: 'reply', reply: { id: 'place_order', title: '✅ Place Order' } },
    { type: 'reply', reply: { id: 'modify_order', title: '✏️ Modify Order' } }
  ];
  
  await sendInteractiveMessage(phoneNumber, message, buttons);
  updateUserSession(phoneNumber, { 
    state: SESSION_STATES.ORDER_SUMMARY,
    userData: session.userData,
    orderData: session.orderData
  });
}

async function handlePlaceOrder(phoneNumber) {
  const session = getUserSession(phoneNumber);
  
  // Generate order number
  const orderNumber = `ORD${Date.now()}`;
  
  // Prepare order data for database
  const orderData = {
    orderNumber: orderNumber,
    customerPhone: phoneNumber,
    customerName: session.userData.name,
    address: session.userData.address,
    items: session.orderData.items,
    total: session.orderData.total,
    paymentMethod: session.orderData.paymentMethod,
    status: 'pending_vendor_confirmation',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  try {
    // Save order to database using your existing function
    const savedOrder = await saveOrder(orderData);
    console.log('✅ Order saved to database:', savedOrder);
    
    session.orderData.orderId = savedOrder.insertedId || savedOrder._id;
    session.orderData.orderNumber = orderNumber;
    
    // Update user order status
    userOrderStatus[phoneNumber] = {
      orderId: session.orderData.orderId,
      orderNumber: orderNumber,
      status: 'pending_vendor_confirmation'
    };
    
    // Confirm to customer
    await sendTextMessage(phoneNumber, `🎉 Order placed successfully!

*Order Number:* ${orderNumber}
*Total Amount:* ₹${session.orderData.total}

We're connecting you with the nearest vendor. Please wait... ⏳`);
    
    // Find and assign vendor
    const assignedVendor = vendors[0]; // For now, assign first vendor
    await assignVendorToOrder(session.orderData.orderId, assignedVendor);
    
    // Notify vendor
    const vendorMessage = `🆕 *New Order Received*

*Order #:* ${orderNumber}
*Customer:* ${session.userData.name}
*Phone:* ${phoneNumber}
*Address:* ${session.userData.address}
*Items:* ${session.orderData.items.length} items
*Total:* ₹${session.orderData.total}
*Payment:* ${session.orderData.paymentMethod}

Please respond to accept or reject this order.`;
    
    const vendorButtons = [
      { type: 'reply', reply: { id: `accept_${orderNumber}`, title: '✅ Accept Order' } },
      { type: 'reply', reply: { id: `reject_${orderNumber}`, title: '❌ Reject Order' } }
    ];
    
    await sendInteractiveMessage(assignedVendor, vendorMessage, vendorButtons);
    
    updateUserSession(phoneNumber, { 
      state: SESSION_STATES.ORDER_PLACED,
      orderData: session.orderData
    });
    
    // Auto-accept simulation for demo (remove in production)
    setTimeout(() => {
      simulateVendorAcceptance(phoneNumber, orderNumber);
    }, 30000); // 30 seconds
    
  } catch (error) {
    console.error('❌ Error placing order:', error);
    await sendTextMessage(phoneNumber, '❌ Sorry, there was an error placing your order. Please try again or contact support.');
  }
}

async function simulateVendorAcceptance(phoneNumber, orderNumber) {
  const session = getUserSession(phoneNumber);
  
  try {
    // Update order status in database
    const orderId = session.orderData.orderId;
    // You might need to create an updateOrder function in your db.js
    console.log(`✅ Order ${orderNumber} accepted by vendor`);
    
    // Update user order status
    if (userOrderStatus[phoneNumber]) {
      userOrderStatus[phoneNumber].status = 'vendor_accepted';
    }
    
    // Schedule collection time (2 hours from now)
    const collectionTime = new Date();
    collectionTime.setHours(collectionTime.getHours() + 2);
    
    // Notify customer
    await sendTextMessage(phoneNumber, `✅ Great news! Your order has been accepted by our vendor.

📅 *Collection Schedule:*
Date: ${collectionTime.toLocaleDateString()}
Time: ${collectionTime.toLocaleTimeString()}

Our team will arrive at your location for pickup. Please keep your items ready! 📦`);
    
    // Confirm with vendor
    await sendTextMessage(VENDOR_PHONE_1, `✅ Order ${orderNumber} confirmed with customer. 

*Collection Details:*
Customer: ${session.userData.name}
Address: ${session.userData.address}
Time: ${collectionTime.toLocaleTimeString()}

Proceed with collection as scheduled.`);
    
    // Notify delivery partner
    const deliveryMessage = `🚛 *New Pickup Assignment*

*Order #:* ${orderNumber}
*Customer:* ${session.userData.name}
*Phone:* ${phoneNumber}
*Pickup Address:* ${session.userData.address}
*Collection Time:* ${collectionTime.toLocaleTimeString()}
*Items:* ${session.orderData.items.length} items

Please coordinate with vendor for pickup.`;
    
    await sendTextMessage(DELIVERY_PARTNER_PHONE, deliveryMessage);
    
    updateUserSession(phoneNumber, { state: SESSION_STATES.VENDOR_CONFIRMATION });
    
    // Simulate collection progress
    setTimeout(() => {
      simulateCollection(phoneNumber, orderNumber);
    }, 120000); // 2 minutes for demo
    
  } catch (error) {
    console.error('❌ Error in vendor acceptance:', error);
  }
}

async function simulateCollection(phoneNumber, orderNumber) {
  const session = getUserSession(phoneNumber);
  
  // Update order status
  if (userOrderStatus[phoneNumber]) {
    userOrderStatus[phoneNumber].status = 'collected';
  }
  
  await sendTextMessage(phoneNumber, `📦 Your items have been collected!

*Order #:* ${orderNumber}
*Status:* In Transit 🚛
*Processing at:* Premium Laundry Center
*Estimated Completion:* 4-6 hours

We'll notify you once your items are ready for delivery! ✨

*Progress Timeline:*
✅ Order Placed
✅ Vendor Assigned  
✅ Items Collected
🔄 Processing
⏳ Quality Check
⏳ Ready for Delivery`);
  
  await sendTextMessage(DELIVERY_PARTNER_PHONE, `✅ Items collected for order ${orderNumber}. Processing initiated at laundry center.`);
  
  updateUserSession(phoneNumber, { state: SESSION_STATES.IN_TRANSIT });
  
  // Simulate delivery ready
  setTimeout(() => {
    simulateDeliveryReady(phoneNumber, orderNumber);
  }, 300000); // 5 minutes for demo
}

async function simulateDeliveryReady(phoneNumber, orderNumber) {
  const session = getUserSession(phoneNumber);
  
  // Update order status
  if (userOrderStatus[phoneNumber]) {
    userOrderStatus[phoneNumber].status = 'ready_for_delivery';
  }
  
  const deliveryTime = new Date();
  deliveryTime.setMinutes(deliveryTime.getMinutes() + 30);
  
  await sendTextMessage(phoneNumber, `🎉 Your laundry is ready for delivery!

*Order #:* ${orderNumber}
*Processing:* Completed ✅
*Estimated Delivery:* ${deliveryTime.toLocaleTimeString()}
*Total Amount:* ₹${session.orderData.total}

*Progress Timeline:*
✅ Order Placed
✅ Vendor Assigned  
✅ Items Collected
✅ Processing Complete
✅ Quality Check Done
🚚 Out for Delivery

Our delivery partner is on the way! 🚚`);
  
  // Notify delivery partner
  await sendTextMessage(DELIVERY_PARTNER_PHONE, `🚚 Order ${orderNumber} ready for delivery.

Customer: ${session.userData.name}
Address: ${session.userData.address}
Amount: ₹${session.orderData.total}
Payment: ${session.orderData.paymentMethod}

Please proceed with delivery.`);
  
  // Simulate delivery completion
  setTimeout(() => {
    simulateDeliveryComplete(phoneNumber, orderNumber);
  }, 180000); // 3 minutes for demo
}

async function simulateDeliveryComplete(phoneNumber, orderNumber) {
  const session = getUserSession(phoneNumber);
  
  // Update order status
  if (userOrderStatus[phoneNumber]) {
    userOrderStatus[phoneNumber].status = 'delivered';
  }
  
  await sendTextMessage(phoneNumber, `✅ *Order Delivered Successfully!*

*Order #:* ${orderNumber}
*Delivery Time:* ${new Date().toLocaleTimeString()}

Thank you for choosing Sparkling Clean Laundry! 

Please rate your experience:`);
  
  const buttons = [
    { type: 'reply', reply: { id: 'rate_excellent', title: '⭐⭐⭐⭐⭐ Excellent' } },
    { type: 'reply', reply: { id: 'rate_good', title: '⭐⭐⭐⭐ Good' } },
    { type: 'reply', reply: { id: 'rate_average', title: '⭐⭐⭐ Average' } }
  ];
  
  await sendInteractiveMessage(phoneNumber, 'How was your experience?', buttons);
  
  await sendTextMessage(DELIVERY_PARTNER_PHONE, `✅ Order ${orderNumber} delivered successfully to ${session.userData.name}. Please collect customer feedback if possible.`);
  
  updateUserSession(phoneNumber, { state: SESSION_STATES.DELIVERED });
}

async function handleFeedback(phoneNumber, rating) {
  const session = getUserSession(phoneNumber);
  const orderNumber = session.orderData.orderNumber;
  
  const ratingText = {
    'rate_excellent': '⭐⭐⭐⭐⭐ Excellent',
    'rate_good': '⭐⭐⭐⭐ Good', 
    'rate_average': '⭐⭐⭐ Average'
  };
  
  // Update order status
  if (userOrderStatus[phoneNumber]) {
    userOrderStatus[phoneNumber].status = 'completed';
    userOrderStatus[phoneNumber].feedback = rating;
  }
  
  await sendTextMessage(phoneNumber, `🙏 Thank you for rating us ${ratingText[rating]}!

Your feedback helps us improve our service quality.

*Order Summary:*
Order #: ${orderNumber}
Total: ₹${session.orderData.total}
Status: Completed ✅

We look forward to serving you again! For new orders, just say "hi" 😊`);
  
  // Reset session
  updateUserSession(phoneNumber, { 
    state: SESSION_STATES.INITIAL,
    userData: {},
    orderData: {}
  });
  
  console.log(`✅ Order ${orderNumber} completed with feedback: ${rating}`);
}

async function handleContactUs(phoneNumber) {
  const message = `📞 *Contact Information*

*Customer Support:* +91-XXXXX-XXXXX
*Email:* support@sparklingclean.com
*Hours:* 8:00 AM - 10:00 PM (7 days)

*Our Services:*
• Wash & Fold
• Dry Cleaning  
• Ironing & Pressing
• Shoe Cleaning
• Carpet Cleaning

*Branches:*
• Main Branch: 123 Clean Street, City
• North Branch: 456 Wash Road, City

How can we help you further?`;

  const buttons = [
    { type: 'reply', reply: { id: 'order_now', title: '🛍️ Order Now' } },
    { type: 'reply', reply: { id: 'help', title: '❓ More Help' } }
  ];

  await sendInteractiveMessage(phoneNumber, message, buttons);
}

async function handleHelp(phoneNumber) {
  const message = `❓ *How can we help you?*

*Our Services:*
• Wash & Fold - Starting ₹20/item
• Dry Cleaning - Starting ₹50/item
• Ironing & Pressing - Starting ₹15/item
• Shoe Cleaning - Starting ₹100/pair
• Carpet Cleaning - Starting ₹200/sqft

*Process:*
1️⃣ Select items from catalog
2️⃣ Provide pickup details
3️⃣ Choose payment method
4️⃣ We collect & process
5️⃣ Delivery to your door

*Delivery Options:*
• Same day (before 12 PM orders)
• Next day delivery
• Express service (4-6 hours)

*Payment Methods:*
• Cash on Delivery
• UPI/Digital payments
• Credit/Debit cards

Need anything specific?`;

  const buttons = [
    { type: 'reply', reply: { id: 'order_now', title: '🛍️ Start Order' } },
    { type: 'reply', reply: { id: 'contact_us', title: '📞 Contact Us' } }
  ];

  await sendInteractiveMessage(phoneNumber, message, buttons);
}

// Main message handler
async function handleMessage(message) {
  const phoneNumber = message.from;
  const session = getUserSession(phoneNumber);
  
  // Get message content
  let messageText = '';
  let buttonId = '';
  
  if (message.text?.body) {
    messageText = message.text.body.toLowerCase().trim();
  } else if (message.interactive?.button_reply?.id) {
    buttonId = message.interactive.button_reply.id;
  } else if (message.interactive?.catalog_message?.product_retailer_id) {
    // Handle catalog selection
    buttonId = 'catalog_done';
  } else if (message.location) {
    // Handle location sharing
    messageText = `Lat: ${message.location.latitude}, Long: ${message.location.longitude}`;
  }
  
  const input = messageText || buttonId;
  
  console.log(`📱 Message from ${phoneNumber}: "${input}", State: ${session.state}`);
  
  try {
    // Handle vendor responses
    if (vendors.includes(phoneNumber) && input.startsWith('accept_')) {
      const orderNumber = input.replace('accept_', '');
      await sendTextMessage(phoneNumber, `✅ Order ${orderNumber} accepted successfully!`);
      // Find customer and notify
      for (const [customerPhone, status] of Object.entries(userOrderStatus)) {
        if (status.orderNumber === orderNumber) {
          simulateVendorAcceptance(customerPhone, orderNumber);
          break;
        }
      }
      return;
    }
    
    if (vendors.includes(phoneNumber) && input.startsWith('reject_')) {
      const orderNumber = input.replace('reject_', '');
      await sendTextMessage(phoneNumber, `❌ Order ${orderNumber} rejected.`);
      // Handle order rejection logic here
      return;
    }
    
    // Handle customer messages based on state
    switch (session.state) {
      case SESSION_STATES.INITIAL:
        if (input === 'hi' || input === 'hello' || input === 'start' || input === 'menu') {
          await handleWelcomeMessage(phoneNumber);
        } else if (input === 'order_now') {
          await handleOrderNow(phoneNumber);
        } else if (input === 'contact_us') {
          await handleContactUs(phoneNumber);
        } else if (input === 'help') {
          await handleHelp(phoneNumber);
        } else {
          await handleWelcomeMessage(phoneNumber);
        }
        break;
        
      case SESSION_STATES.WAITING_FOR_NAME:
        if (input === 'catalog_done') {
          await handleCatalogDone(phoneNumber);
        } else if (input === 'need_help') {
          await handleHelp(phoneNumber);
        } else {
          await handleNameInput(phoneNumber, input);
        }
        break;
        
      case SESSION_STATES.WAITING_FOR_ADDRESS:
        await handleAddressInput(phoneNumber, input);
        break;
        
      case SESSION_STATES.WAITING_FOR_PAYMENT:
        if (['cash', 'upi', 'card'].includes(input)) {
          await handlePaymentMethod(phoneNumber, input);
        } else {
          await sendTextMessage(phoneNumber, '❓ Please select a payment method using the buttons provided.');
        }
        break;
        
      case SESSION_STATES.ORDER_SUMMARY:
        if (input === 'place_order') {
          await handlePlaceOrder(phoneNumber);
        } else if (input === 'modify_order') {
          await handleOrderNow(phoneNumber);
        }
        break;
        
      case SESSION_STATES.DELIVERED:
        if (input.startsWith('rate_')) {
          await handleFeedback(phoneNumber, input);
        }
        break;
        
      default:
        // Handle common commands in any state
        if (input === 'catalog_done') {
          await handleCatalogDone(phoneNumber);
        } else if (input === 'order_now') {
          await handleOrderNow(phoneNumber);
        } else if (input === 'contact_us') {
          await handleContactUs(phoneNumber);
        } else if (input === 'help') {
          await handleHelp(phoneNumber);
        } else if (input === 'status' && userOrderStatus[phoneNumber]) {
          const status = userOrderStatus[phoneNumber];
          await sendTextMessage(phoneNumber, `📋 *Order Status*

Order #: ${status.orderNumber}
Status: ${status.status}
${status.feedback ? `Feedback: ${status.feedback}` : ''}`);
        } else {
          await sendTextMessage(phoneNumber, '❓ I didn\'t understand that. Type "hi" to start over or use the menu buttons.');
        }
    }
  } catch (error) {
    console.error('❌ Error handling message:', error);
    await sendTextMessage(phoneNumber, '⚠️ Something went wrong. Please try again or contact support.');
  }
}

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook message handler
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  
  console.log('📨 Webhook received:', JSON.stringify(req.body, null, 2));
  
  if (req.body.object === 'whatsapp_business_account') {
    req.body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        if (change.value?.messages) {
          change.value.messages.forEach(message => {
            console.log('📱 Processing message:', message);
            handleMessage(message).catch(error => {
              console.error('❌ Error processing message:', error);
            });
          });
        }
        
        // Handle message status updates (delivered, read, etc.)
        if (change.value?.statuses) {
          change.value.statuses.forEach(status => {
            console.log('📊 Message status update:', status);
          });
        }
      });
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activeSessions: Object.keys(sessions).length,
    activeOrders: Object.keys(userOrderStatus).length,
    verifiedNumbers: verifiedNumbers.length
  });
});

// Admin endpoint to check sessions (for debugging)
app.get('/admin/sessions', (req, res) => {
  res.status(200).json({
    sessions: sessions,
    userOrderStatus: userOrderStatus
  });
});

// Admin endpoint to clear sessions (for debugging)
app.post('/admin/clear-sessions', (req, res) => {
  const phoneNumber = req.body.phoneNumber;
  
  if (phoneNumber) {
    delete sessions[phoneNumber];
    delete userOrderStatus[phoneNumber];
    res.status(200).json({ message: `Session cleared for ${phoneNumber}` });
  } else {
    // Clear all sessions
    Object.keys(sessions).forEach(key => delete sessions[key]);
    Object.keys(userOrderStatus).forEach(key => delete userOrderStatus[key]);
    res.status(200).json({ message: 'All sessions cleared' });
  }
});

// Manual message sending endpoint (for testing)
app.post('/admin/send-message', async (req, res) => {
  const { to, message, type = 'text' } = req.body;
  
  if (!to || !message) {
    return res.status(400).json({ error: 'Missing required parameters: to, message' });
  }
  
  try {
    if (type === 'text') {
      await sendTextMessage(to, message);
    } else if (type === 'interactive' && req.body.buttons) {
      await sendInteractiveMessage(to, message, req.body.buttons);
    }
    
    res.status(200).json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Order status endpoint
app.get('/admin/order-status/:phoneNumber', (req, res) => {
  const phoneNumber = req.params.phoneNumber;
  const status = userOrderStatus[phoneNumber];
  
  if (status) {
    res.status(200).json(status);
  } else {
    res.status(404).json({ error: 'No active order found for this number' });
  }
});

// Vendor management endpoints
app.post('/admin/add-vendor', (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required' });
  }
  
  if (!vendors.includes(phoneNumber)) {
    vendors.push(phoneNumber);
    res.status(200).json({ message: `Vendor ${phoneNumber} added successfully`, vendors });
  } else {
    res.status(400).json({ error: 'Vendor already exists' });
  }
});

app.get('/admin/vendors', (req, res) => {
  res.status(200).json({ vendors });
});

// Verified numbers management
app.post('/admin/add-verified-number', (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required' });
  }
  
  if (!verifiedNumbers.includes(phoneNumber)) {
    verifiedNumbers.push(phoneNumber);
    res.status(200).json({ message: `Number ${phoneNumber} verified successfully`, verifiedNumbers });
  } else {
    res.status(400).json({ error: 'Number already verified' });
  }
});

app.get('/admin/verified-numbers', (req, res) => {
  res.status(200).json({ verifiedNumbers });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start server
app.listen(port, () => {
  console.log(`🚀 WhatsApp Laundry Bot server running on port ${port}`);
  console.log(`📱 Webhook URL: https://your-domain.com/webhook`);
  console.log(`🔧 Health check: https://your-domain.com/health`);
  console.log(`👥 Verified numbers: ${verifiedNumbers.length}`);
  console.log(`🏪 Vendors: ${vendors.length}`);
  console.log(`✅ Bot is ready to receive messages!`);
});