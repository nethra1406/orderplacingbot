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

  console.log(`🛒 Catalog done - checking cart for ${phoneNumber}:`, {
    items: session.orderData.items,
    total: session.orderData.total,
    itemCount: session.orderData.items?.length || 0
  });

  if (!session.orderData.items || session.orderData.items.length === 0) {
    const buttons = [
      { type: 'reply', reply: { id: 'confirm_50_item', title: '✅ Confirm ₹50 Item' } },
      { type: 'reply', reply: { id: 'select_again', title: '🔄 Select Again' } },
      { type: 'reply', reply: { id: 'manual_add', title: '➕ Add Manually' } }
    ];

    await sendInteractiveMessage(phoneNumber, 
      `I can see you selected an item, but I couldn't capture the details automatically. 
      
Please help me confirm your selection:`, buttons);

    return;
  }

  await showCartSummary(phoneNumber);
}

async function handleManualConfirmation(phoneNumber, buttonId) {
  const session = getUserSession(phoneNumber);

  if (buttonId === 'confirm_50_item') {
    const newItem = {
      productId: 'manual_item_50',
      name: 'Laundry Service Item',
      quantity: 1,
      price: 50,
      total: 50,
      currency: 'INR'
    };

    session.orderData.items = [newItem];
    session.orderData.total = 50;
    updateUserSession(phoneNumber, session);

    await sendTextMessage(phoneNumber, '✅ Item confirmed! Added ₹50 item to your cart.');
    await showCartSummary(phoneNumber);

  } else if (buttonId === 'select_again') {
    await handleOrderNow(phoneNumber);

  } else if (buttonId === 'manual_add') {
    await sendTextMessage(phoneNumber, 'Please type: ADD [item name] [price]\nExample: ADD Shirt Wash 50');
  }
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

  console.log('🔍 DEBUGGING - Full message object:', JSON.stringify(message, null, 2));

  // Method 1: Check for order type message
  if (message.type === 'order' && message.order) {
    console.log('📦 Method 1: Order type message detected');
    await handleCatalogSelection(phoneNumber, message.order);
    return;
  }

  // Method 2: Check for interactive catalog message
  if (message.type === 'interactive' && message.interactive?.type === 'catalog_message') {
    console.log('📦 Method 2: Interactive catalog message detected');
    await handleInteractiveCatalogMessage(phoneNumber, message.interactive);
    return;
  }

  // Method 3: Check for interactive product message
  if (message.type === 'interactive' && message.interactive?.type === 'product') {
    console.log('📦 Method 3: Interactive product message detected');
    await handleProductMessage(phoneNumber, message.interactive);
    return;
  }

  // Method 4: Check for product_inquiry type
  if (message.type === 'interactive' && message.interactive?.type === 'product_inquiry') {
    console.log('📦 Method 4: Product inquiry detected');
    await handleProductInquiry(phoneNumber, message.interactive);
    return;
  }

  // Method 5: Check if there's any catalog-related data in the message
  if (message.catalog || message.product || message.products) {
    console.log('📦 Method 5: Direct catalog/product data detected');
    await handleDirectCatalogData(phoneNumber, message);
    return;
  }

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
        } else {
          await sendTextMessage(phoneNumber, 'I\'m here to assist you. Please select an option or type your message.');
        }
    }
  } catch (error) {
    console.error('❌ Error handling message:', error);
    await sendTextMessage(phoneNumber, '❌ Oops! Something went wrong. Please try again or contact support.');
  }
}

// Webhook verification for Facebook Messenger
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const port = req.query['port'];

  console.log('Webhook verification:', { mode, token, port });

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      res.status(200).send(req.query['hub.challenge']);
    } else {
      console.log('Webhook verification failed: Invalid token');
      res.sendStatus(403);
    }
  } else {
    console.log('Webhook verification failed: Missing mode or token');
    res.sendStatus(400);
  }
});

// Webhook for incoming messages
app.post('/webhook', (req, res) => {
  const body = req.body;

  console.log('Webhook received:', JSON.stringify(body, null, 2));

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry[0];
    const changes = entry.changes[0];
    const value = changes.value;
    const messagingEvent = value.messages?.[0] || value.message;

    if (messagingEvent) {
      handleMessage(messagingEvent);
    }

    res.sendStatus(200);
  } else {
    console.log('Webhook ignored: Not a WhatsApp Business Account event');
    res.sendStatus(200);
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});