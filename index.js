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
  CATALOG_BROWSING: 'catalog_browsing',
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
      orderData: {
        items: [],
        total: 0
      },
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

// Function to get product details from Facebook catalog
async function getProductDetails(productId) {
  try {
    const url = `https://graph.facebook.com/v20.0/${productId}?fields=name,price,description,retailer_id&access_token=${ACCESS_TOKEN}`;
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('❌ Error fetching product details:', error);
    return {
      name: 'Unknown Product',
      price: '0',
      description: 'Product details unavailable',
      retailer_id: productId
    };
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
  
  const message = `Please browse our catalog above and select the items you need.

👆 Tap on items to add them to your cart
📦 Once you're done selecting, click "Done Selecting" below`;
  
  const buttons = [
    { type: 'reply', reply: { id: 'catalog_done', title: '✅ Done Selecting' } },
    { type: 'reply', reply: { id: 'view_cart', title: '🛒 View Cart' } },
    { type: 'reply', reply: { id: 'need_help', title: '❓ Need Help' } }
  ];
  
  await sendInteractiveMessage(phoneNumber, message, buttons);
  updateUserSession(phoneNumber, { state: SESSION_STATES.CATALOG_BROWSING });
}

async function handleCatalogSelection(phoneNumber, orderData) {
  const session = getUserSession(phoneNumber);
  
  try {
    // Parse the order data from WhatsApp catalog message
    const productItems = orderData.order?.product_items || [];
    const items = [];
    let total = 0;
    
    // Process each selected item
    for (const item of productItems) {
      const productDetails = await getProductDetails(item.product_retailer_id);
      const quantity = parseInt(item.quantity) || 1;
      const itemPrice = parseFloat(productDetails.price) || 0;
      const itemTotal = itemPrice * quantity;
      
      const orderItem = {
        productId: item.product_retailer_id,
        name: productDetails.name,
        quantity: quantity,
        price: itemPrice,
        total: itemTotal,
        currency: item.currency || 'INR'
      };
      
      items.push(orderItem);
      total += itemTotal;
    }
    
    // Update session with actual catalog selections
    session.orderData.items = items;
    session.orderData.total = total;
    
    updateUserSession(phoneNumber, session);
    
    // Show cart summary
    await showCartSummary(phoneNumber);
    
  } catch (error) {
    console.error('❌ Error processing catalog selection:', error);
    await sendTextMessage(phoneNumber, '❌ There was an error processing your selection. Please try again or contact support.');
  }
}

async function showCartSummary(phoneNumber) {
  const session = getUserSession(phoneNumber);
  const items = session.orderData.items;
  
  if (!items || items.length === 0) {
    await sendTextMessage(phoneNumber, '🛒 Your cart is empty. Please select items from the catalog first.');
    return;
  }
  
  let itemsList = '🛒 *Your Cart:*\n\n';
  items.forEach((item, index) => {
    itemsList += `${index + 1}. ${item.name}\n   Qty: ${item.quantity} × ₹${item.price} = ₹${item.total}\n\n`;
  });
  
  itemsList += `*Total Amount: ₹${session.orderData.total}*`;
  
  const buttons = [
    { type: 'reply', reply: { id: 'proceed_checkout', title: '✅ Proceed to Checkout' } },
    { type: 'reply', reply: { id: 'add_more_items', title: '➕ Add More Items' } },
    { type: 'reply', reply: { id: 'clear_cart', title: '🗑️ Clear Cart' } }
  ];
  
  await sendInteractiveMessage(phoneNumber, itemsList, buttons);
}

async function handleCatalogDone(phoneNumber) {
  const session = getUserSession(phoneNumber);
  
  // Check if user has selected any items
  if (!session.orderData.items || session.orderData.items.length === 0) {
    await sendTextMessage(phoneNumber, '🛒 You haven\'t selected any items yet. Please browse the catalog and select items first.');
    
    const buttons = [
      { type: 'reply', reply: { id: 'order_now', title: '🛍️ Browse Catalog Again' } },
      { type: 'reply', reply: { id: 'help', title: '❓ Need Help' } }
    ];
    
    await sendInteractiveMessage(phoneNumber, 'Would you like to browse our catalog?', buttons);
    return;
  }
  
  // Show cart summary first
  await showCartSummary(phoneNumber);
}

async function handleProceedCheckout(phoneNumber) {
  const session = getUserSession(phoneNumber);
  
  if (!session.orderData.items || session.orderData.items.length === 0) {
    await handleOrderNow(phoneNumber);
    return;
  }
  
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
    return;
  } else if (input === 'type_address') {
    await sendTextMessage(phoneNumber, '✍️ Please type your complete pickup/delivery address:');
    return;
  } else {
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
  
  const items = session.orderData.items;
  const total = session.orderData.total;
  
  let itemsList = items.map((item, index) => 
    `${index + 1}. ${item.name} (${item.quantity}x) - ₹${item.total}`
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
  
  const orderNumber = `ORD${Date.now()}`;
  
  const orderData = {
    orderNumber: orderNumber,
    customerPhone: phoneNumber,
    customerName: session.userData.name,
    address: session.userData.address,
    items: session.orderData.items,
    total: session.orderData.total,
    paymentMethod: session.userData.paymentMethod,
    status: 'pending_vendor_confirmation',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  try {
    const savedOrder = await saveOrder(orderData);
    console.log('✅ Order saved to database:', savedOrder);
    
    session.orderData.orderId = savedOrder.insertedId || savedOrder._id;
    session.orderData.orderNumber = orderNumber;
    
    userOrderStatus[phoneNumber] = {
      orderId: session.orderData.orderId,
      orderNumber: orderNumber,
      status: 'pending_vendor_confirmation'
    };
    
    await sendTextMessage(phoneNumber, `🎉 Order placed successfully!

*Order Number:* ${orderNumber}
*Total Amount:* ₹${session.orderData.total}

We're connecting you with the nearest vendor. Please wait... ⏳`);
    
    const assignedVendor = vendors[0];
    await assignVendorToOrder(session.orderData.orderId, assignedVendor);
    
    // Create vendor message with actual items
    let vendorItemsList = session.orderData.items.map(item => 
      `• ${item.name} (${item.quantity}x)`
    ).join('\n');
    
    const vendorMessage = `🆕 *New Order Received*

*Order #:* ${orderNumber}
*Customer:* ${session.userData.name}
*Phone:* ${phoneNumber}
*Address:* ${session.userData.address}

*Items:*
${vendorItemsList}

*Total:* ₹${session.orderData.total}
*Payment:* ${session.userData.paymentMethod}

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
    
    // Auto-accept simulation for demo
    setTimeout(() => {
      simulateVendorAcceptance(phoneNumber, orderNumber);
    }, 15000); // 15 seconds
    
  } catch (error) {
    console.error('❌ Error placing order:', error);
    await sendTextMessage(phoneNumber, '❌ Sorry, there was an error placing your order. Please try again or contact support.');
  }
}

// Continue with existing simulation functions...
async function simulateVendorAcceptance(phoneNumber, orderNumber) {
  const session = getUserSession(phoneNumber);
  
  try {
    console.log(`✅ Order ${orderNumber} accepted by vendor`);
    
    if (userOrderStatus[phoneNumber]) {
      userOrderStatus[phoneNumber].status = 'vendor_accepted';
    }
    
    const collectionTime = new Date();
    collectionTime.setHours(collectionTime.getHours() + 2);
    
    await sendTextMessage(phoneNumber, `✅ Great news! Your order has been accepted by our vendor.

📅 *Collection Schedule:*
Date: ${collectionTime.toLocaleDateString()}
Time: ${collectionTime.toLocaleTimeString()}

Our team will arrive at your location for pickup. Please keep your items ready! 📦`);
    
    await sendTextMessage(VENDOR_PHONE_1, `✅ Order ${orderNumber} confirmed with customer. 

*Collection Details:*
Customer: ${session.userData.name}
Address: ${session.userData.address}
Time: ${collectionTime.toLocaleTimeString()}

Proceed with collection as scheduled.`);
    
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
    
    setTimeout(() => {
      simulateCollection(phoneNumber, orderNumber);
    }, 60000); // 1 minute for demo
    
  } catch (error) {
    console.error('❌ Error in vendor acceptance:', error);
  }
}

// Main message handler
async function handleMessage(message) {
  const phoneNumber = message.from;
  const session = getUserSession(phoneNumber);
  
  let messageText = '';
  let buttonId = '';
  let orderData = null;
  
  if (message.text?.body) {
    messageText = message.text.body.toLowerCase().trim();
  } else if (message.interactive?.button_reply?.id) {
    buttonId = message.interactive.button_reply.id;
  } else if (message.order) {
    // Handle catalog order - this is the key fix!
    orderData = message.order;
    await handleCatalogSelection(phoneNumber, orderData);
    return;
  } else if (message.location) {
    messageText = `Lat: ${message.location.latitude}, Long: ${message.location.longitude}`;
  }
  
  const input = messageText || buttonId;
  
  console.log(`📱 Message from ${phoneNumber}: "${input}", State: ${session.state}`);
  
  try {
    // Handle vendor responses
    if (vendors.includes(phoneNumber) && input.startsWith('accept_')) {
      const orderNumber = input.replace('accept_', '');
      await sendTextMessage(phoneNumber, `✅ Order ${orderNumber} accepted successfully!`);
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
        
      case SESSION_STATES.CATALOG_BROWSING:
        if (input === 'catalog_done') {
          await handleCatalogDone(phoneNumber);
        } else if (input === 'view_cart') {
          await showCartSummary(phoneNumber);
        } else if (input === 'add_more_items') {
          await handleOrderNow(phoneNumber);
        } else if (input === 'clear_cart') {
          session.orderData.items = [];
          session.orderData.total = 0;
          updateUserSession(phoneNumber, { orderData: session.orderData });
          await sendTextMessage(phoneNumber, '🗑️ Cart cleared! Browse the catalog to add new items.');
          await handleOrderNow(phoneNumber);
        } else if (input === 'proceed_checkout') {
          await handleProceedCheckout(phoneNumber);
        } else if (input === 'need_help') {
          await handleHelp(phoneNumber);
        } else {
          await sendTextMessage(phoneNumber, 'Please select items from the catalog or use the buttons provided.');
        }
        break;
        
      case SESSION_STATES.WAITING_FOR_NAME:
        await handleNameInput(phoneNumber, input);
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

// Continue with rest of the existing functions...
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

async function handleFeedback(phoneNumber, rating) {
  const session = getUserSession(phoneNumber);
  const orderNumber = session.orderData.orderNumber;
  
  const ratingText = {
    'rate_excellent': '⭐⭐⭐⭐⭐ Excellent',
    'rate_good': '⭐⭐⭐⭐ Good', 
    'rate_average': '⭐⭐⭐ Average'
  };
  
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
    orderData: { items: [], total: 0 }
  });
  
  console.log(`✅ Order ${orderNumber} completed with feedback: ${rating}`);
}

// Continue with remaining simulation functions
async function simulateCollection(phoneNumber, orderNumber) {
  const session = getUserSession(phoneNumber);
  
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
  
  setTimeout(() => {
    simulateDeliveryReady(phoneNumber, orderNumber);
  }, 120000); // 2 minutes for demo
}

async function simulateDeliveryReady(phoneNumber, orderNumber) {
  const session = getUserSession(phoneNumber);
  
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
  
  await sendTextMessage(DELIVERY_PARTNER_PHONE, `🚚 Order ${orderNumber} ready for delivery.

Customer: ${session.userData.name}
Address: ${session.userData.address}
Amount: ₹${session.orderData.total}
Payment: ${session.userData.paymentMethod}

Please proceed with delivery.`);
  
  setTimeout(() => {
    simulateDeliveryComplete(phoneNumber, orderNumber);
  }, 90000); // 1.5 minutes for demo
}

async function simulateDeliveryComplete(phoneNumber, orderNumber) {
  const session = getUserSession(phoneNumber);
  
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

// Admin endpoint to check sessions
app.get('/admin/sessions', (req, res) => {
  res.status(200).json({
    sessions: sessions,
    userOrderStatus: userOrderStatus
  });
});

// Admin endpoint to clear sessions
app.post('/admin/clear-sessions', (req, res) => {
  const phoneNumber = req.body.phoneNumber;
  
  if (phoneNumber) {
    delete sessions[phoneNumber];
    delete userOrderStatus[phoneNumber];
    res.status(200).json({ message: `Session cleared for ${phoneNumber}` });
  } else {
    Object.keys(sessions).forEach(key => delete sessions[key]);
    Object.keys(userOrderStatus).forEach(key => delete userOrderStatus[key]);
    res.status(200).json({ message: 'All sessions cleared' });
  }
});

// API endpoint to get catalog items (for testing)
app.get('/admin/catalog/:catalogId', async (req, res) => {
  try {
    const catalogId = req.params.catalogId;
    const url = `https://graph.facebook.com/v20.0/${catalogId}/products?fields=name,price,description,retailer_id,image_url&access_token=${ACCESS_TOKEN}`;
    const response = await axios.get(url);
    res.status(200).json(response.data);
  } catch (error) {
    console.error('❌ Error fetching catalog:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual message sending endpoint
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
    } else if (type === 'catalog') {
      await sendCatalog(to);
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

// Test catalog order endpoint (for debugging)
app.post('/admin/test-catalog-order', async (req, res) => {
  const { phoneNumber, mockOrder } = req.body;
  
  try {
    const mockMessage = {
      from: phoneNumber,
      order: mockOrder || {
        catalog_id: CATALOG_ID,
        product_items: [
          {
            product_retailer_id: 'test_product_1',
            quantity: '2',
            currency: 'INR'
          }
        ]
      }
    };
    
    await handleMessage(mockMessage);
    res.status(200).json({ success: true, message: 'Test catalog order processed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
  console.log(`🛒 Catalog ID: ${CATALOG_ID}`);
  console.log(`✅ Bot is ready to receive messages and catalog orders!`);
});