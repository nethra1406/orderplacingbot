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
  PHONE_NUMBER_ID,
  ACCESS_TOKEN,
  VERIFY_TOKEN,
  MONGODB_URI,
  DB_NAME,
  VENDOR_PHONE_1,
  DELIVERY_PARTNER_PHONE,
  CATALOG_ID
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
const vendors = [VENDOR_PHONE_1];
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
  CATALOG_Browse: 'catalog_Browse',
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
    console.error('❌ Error fetching product details:', error.response?.data || error.message);
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
📦 Once you're done selecting, click the 'View cart' or 'Send to business' button inside the catalog.`;
  
  await sendTextMessage(phoneNumber, message);
  updateUserSession(phoneNumber, { state: SESSION_STATES.CATALOG_Browse });
}


async function handleCatalogSelection(phoneNumber, orderPayload) {
  const session = getUserSession(phoneNumber);

  try {
    const productItems = orderPayload.product_items || [];
    if (productItems.length === 0) {
        await sendTextMessage(phoneNumber, 'It seems you sent an empty cart. Please add items from the catalog first!');
        return;
    }

    const items = [];
    let total = 0;

    for (const item of productItems) {
      const productDetails = await getProductDetails(item.product_retailer_id);
      const quantity = parseInt(item.quantity, 10) || 1;
      // Note: The price comes from the Catalog API, not the webhook payload.
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

    session.orderData.items = items;
    session.orderData.total = total;

    updateUserSession(phoneNumber, { orderData: session.orderData });
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
    await handleOrderNow(phoneNumber); // Re-prompt to order
    return;
  }

  let itemsList = '🛒 *Your Cart Summary:*\n\n';
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

async function handleProceedCheckout(phoneNumber) {
  const session = getUserSession(phoneNumber);
  
  if (!session.orderData.items || session.orderData.items.length === 0) {
    await sendTextMessage(phoneNumber, "Your cart is empty. Let's add some items first!");
    await handleOrderNow(phoneNumber);
    return;
  }
  
  const message = `Great! Let's get your details to process the order.

What's your full name? 👤`;
  
  await sendTextMessage(phoneNumber, message);
  updateUserSession(phoneNumber, { state: SESSION_STATES.WAITING_FOR_NAME });
}

async function handleNameInput(phoneNumber, name) {
  const session = getUserSession(phoneNumber);
  session.userData.name = name;
  
  const message = `Thanks ${session.userData.name}! 

Now, please share your complete pickup & delivery address. 📍`;

  await sendTextMessage(phoneNumber, message);
  updateUserSession(phoneNumber, { 
    state: SESSION_STATES.WAITING_FOR_ADDRESS,
    userData: session.userData 
  });
}

async function handleAddressInput(phoneNumber, address) {
  const session = getUserSession(phoneNumber);
  session.userData.address = address;

  const message = `Perfect! Address noted.

How would you like to pay? 💳`;
  
  const buttons = [
    { type: 'reply', reply: { id: 'cash', title: '💵 Cash on Delivery' } },
    { type: 'reply', reply: { id: 'upi', title: '📱 UPI (Online)' } }
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
    'upi': '📱 UPI (Online)'
  };
  
  const message = `📋 *Please Confirm Your Order*

*Items:*
${itemsList}

*Total Amount:* ₹${total}
*Payment Method:* ${paymentText[paymentMethod]}
*Customer:* ${session.userData.name}
*Address:* ${session.userData.address}

Is everything correct?`;
  
  const buttons = [
    { type: 'reply', reply: { id: 'place_order', title: '✅ Place Order' } },
    { type: 'reply', reply: { id: 'modify_order', title: '✏️ Modify Order' } }
  ];
  
  await sendInteractiveMessage(phoneNumber, message, buttons);
  updateUserSession(phoneNumber, { 
    state: SESSION_STATES.ORDER_SUMMARY,
    userData: session.userData
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
    
    await sendTextMessage(phoneNumber, `🎉 Order placed successfully!\n\n*Order Number:* ${orderNumber}\n*Total Amount:* ₹${session.orderData.total}\n\nWe're now confirming with our nearest vendor. Please wait... ⏳`);
    
    const assignedVendor = vendors[0]; // Simple assignment for now
    await assignVendorToOrder(session.orderData.orderId, assignedVendor);
    
    let vendorItemsList = session.orderData.items.map(item => 
      `• ${item.name} (${item.quantity}x)`
    ).join('\n');
    
    const vendorMessage = `🆕 *New Order Received*\n\n*Order #:* ${orderNumber}\n*Customer:* ${session.userData.name}\n*Phone:* ${phoneNumber}\n*Address:* ${session.userData.address}\n\n*Items:*\n${vendorItemsList}\n\n*Total:* ₹${session.orderData.total}\n*Payment:* ${session.userData.paymentMethod}`;
    
    const vendorButtons = [
      { type: 'reply', reply: { id: `accept_${orderNumber}`, title: '✅ Accept Order' } },
      { type: 'reply', reply: { id: `reject_${orderNumber}`, title: '❌ Reject Order' } }
    ];
    
    await sendInteractiveMessage(assignedVendor, vendorMessage, vendorButtons);
    
    // Reset session for next order
    delete sessions[phoneNumber];

  } catch (error) {
    console.error('❌ Error placing order:', error);
    await sendTextMessage(phoneNumber, '❌ Sorry, there was an error placing your order. Please try again or contact support.');
  }
}

// Main message handler
async function handleMessage(message) {
  const phoneNumber = message.from;

  console.log('--- Incoming Message ---');
  console.log(JSON.stringify(message, null, 2));
  
  // *** BUG FIX: Check for order payload FIRST ***
  if (message.type === 'order' && message.order) {
    console.log(`📦 Received cart from ${phoneNumber}. Processing...`);
    await handleCatalogSelection(phoneNumber, message.order);
    return;
  }
  
  const session = getUserSession(phoneNumber);
  
  let input = '';
  if (message.text?.body) {
    input = message.text.body.trim();
  } else if (message.interactive?.button_reply?.id) {
    input = message.interactive.button_reply.id;
  } else {
    // Ignore non-text, non-interactive messages that aren't orders
    console.log(`Ignoring non-actionable message type: ${message.type}`);
    return;
  }
  
  console.log(`📱 Message from ${phoneNumber}: "${input}", State: ${session.state}`);

  // Handle vendor responses
  if (vendors.includes(phoneNumber) && (input.startsWith('accept_') || input.startsWith('reject_'))) {
    // This logic would be expanded for real vendor acceptance
    const [action, orderNumber] = input.split('_');
    await sendTextMessage(phoneNumber, `✅ Action '${action}' for order ${orderNumber} has been recorded.`);
    // Here you would find the customer and notify them
    return;
  }
  
  // Handle customer messages based on state
  try {
    switch (session.state) {
      case SESSION_STATES.INITIAL:
        if (input.toLowerCase() === 'hi' || input.toLowerCase() === 'hello' || input === 'order_now') {
          await handleOrderNow(phoneNumber);
        } else {
          await handleWelcomeMessage(phoneNumber);
        }
        break;
        
      case SESSION_STATES.CATALOG_Browse:
        if (input === 'proceed_checkout') {
          await handleProceedCheckout(phoneNumber);
        } else if (input === 'add_more_items') {
          await handleOrderNow(phoneNumber);
        } else if (input === 'clear_cart') {
          session.orderData.items = [];
          session.orderData.total = 0;
          updateUserSession(phoneNumber, { orderData: session.orderData });
          await sendTextMessage(phoneNumber, '🗑️ Cart cleared! Let\'s add some new items.');
          await handleOrderNow(phoneNumber);
        } else {
            await showCartSummary(phoneNumber);
        }
        break;
        
      case SESSION_STATES.WAITING_FOR_NAME:
        await handleNameInput(phoneNumber, input);
        break;
        
      case SESSION_STATES.WAITING_FOR_ADDRESS:
        await handleAddressInput(phoneNumber, input);
        break;
        
      case SESSION_STATES.WAITING_FOR_PAYMENT:
        if (['cash', 'upi'].includes(input)) {
          await handlePaymentMethod(phoneNumber, input);
        } else {
          await sendTextMessage(phoneNumber, '❓ Please select a valid payment method using the buttons.');
        }
        break;
        
      case SESSION_STATES.ORDER_SUMMARY:
        if (input === 'place_order') {
          await handlePlaceOrder(phoneNumber);
        } else if (input === 'modify_order') {
          await sendTextMessage(phoneNumber, "Okay, let's modify your order.");
          await showCartSummary(phoneNumber);
          updateUserSession(phoneNumber, { state: SESSION_STATES.CATALOG_Browse });
        }
        break;
        
      default:
        await handleWelcomeMessage(phoneNumber);
    }
  } catch (error) {
    console.error('❌ Error in state machine:', error);
    await sendTextMessage(phoneNumber, '❌ Oops! Something went wrong on our end. Please type "hi" to restart.');
  }
}


// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook for incoming messages
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      handleMessage(message).catch(err => {
        console.error("Error handling message:", err);
      });
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});