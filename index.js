require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const {
  saveOrder,
  connectDB,
  assignVendorToOrder,
} = require('./db');

const app = express();
const port = process.env.PORT || 10000;
app.use(bodyParser.json());

// Configuration from environment variables
const {
  PHONE_NUMBER_ID,
  ACCESS_TOKEN,
  VERIFY_TOKEN,
  VENDOR_PHONE_1,
  CATALOG_ID
} = process.env;

// Initialize database connection
connectDB().then(() => {
  console.log('✅ Database connected successfully');
}).catch(err => {
  console.error('❌ Database connection failed:', err);
});

// In-memory data (consider moving to DB for production)
const sessions = {};
const vendors = [VENDOR_PHONE_1];

// Session states
const SESSION_STATES = {
  INITIAL: 'initial',
  CATALOG_Browse: 'catalog_Browse',
  WAITING_FOR_NAME: 'waiting_for_name',
  WAITING_FOR_ADDRESS: 'waiting_for_address',
  WAITING_FOR_PAYMENT: 'waiting_for_payment',
  ORDER_SUMMARY: 'order_summary',
};

// Utility functions
function getUserSession(phoneNumber) {
  if (!sessions[phoneNumber]) {
    sessions[phoneNumber] = {
      state: SESSION_STATES.INITIAL,
      userData: {},
      orderData: { items: [], total: 0 },
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
      action: { buttons: buttons }
    }
  };

  try {
    await axios.post(url, payload, {
      headers: { 
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Interactive message sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending interactive message:', error.response?.data || error.message);
    throw error;
  }
}

async function sendTextMessage(to, message) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp', to, type: 'text', text: { body: message }
  };

  try {
    await axios.post(url, payload, {
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
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
      body: { text: '🧺 Please browse our services and select the items you need!' },
      action: {
        name: 'catalog_message',
        catalog_id: CATALOG_ID
      }
    }
  };

  try {
    await axios.post(url, payload, {
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
    });
    console.log(`✅ Catalog sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending catalog:', error.response?.data || error.message);
  }
}

async function getProductDetails(productId) {
  try {
    const url = `https://graph.facebook.com/v20.0/${productId}?fields=name,price&access_token=${ACCESS_TOKEN}`;
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error(`❌ Error fetching product details for ${productId}:`, error.response?.data || error.message);
    return null;
  }
}

// Message handlers
async function handleWelcomeMessage(phoneNumber) {
  const welcomeMessage = `🙏 Welcome to *Wrinkl*!\n\nHow can we assist you today?`;
  const buttons = [
    { type: 'reply', reply: { id: 'order_now', title: '🛍️ Place Order' } },
    { type: 'reply', reply: { id: 'contact_us', title: '📞 Contact Us' } }
  ];
  await sendInteractiveMessage(phoneNumber, welcomeMessage, buttons);
  updateUserSession(phoneNumber, { state: SESSION_STATES.INITIAL });
}

async function handleOrderNow(phoneNumber) {
  await sendCatalog(phoneNumber);
  const message = `👆 Please browse our catalog above.\n\nOnce you're done selecting, click the 'View cart' or 'Send to business' button inside the catalog to proceed.`;
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

    let items = [];
    let total = 0;

    for (const item of productItems) {
      const productDetails = await getProductDetails(item.product_retailer_id);
      
      const itemName = productDetails ? productDetails.name : 'Selected Item';
      const itemPrice = parseFloat(item.item_price);
      const quantity = parseInt(item.quantity, 10) || 1;
      const itemTotal = itemPrice * quantity;

      items.push({
        productId: item.product_retailer_id,
        name: itemName,
        quantity: quantity,
        price: itemPrice,
        total: itemTotal,
        currency: item.currency || 'INR'
      });
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
  const { items, total } = session.orderData;

  if (!items || items.length === 0) {
    await sendTextMessage(phoneNumber, '🛒 Your cart is empty. Please select items from the catalog first.');
    return;
  }

  let itemsList = items.map((item, index) => 
    `${index + 1}. ${item.name}\n   Qty: ${item.quantity} × ₹${item.price.toFixed(2)} = ₹${item.total.toFixed(2)}`
  ).join('\n\n');
  
  const summaryMessage = `🛒 *Your Cart Summary:*\n\n${itemsList}\n\n*Total Amount: ₹${total.toFixed(2)}*`;

  const buttons = [
    { type: 'reply', reply: { id: 'proceed_checkout', title: '✅ Checkout' } },
    { type: 'reply', reply: { id: 'add_more_items', title: '➕ Add More Items' } },
    { type: 'reply', reply: { id: 'clear_cart', title: '🗑️ Clear Cart' } }
  ];
  
  await sendInteractiveMessage(phoneNumber, summaryMessage, buttons);
}

async function handleProceedCheckout(phoneNumber) {
    const session = getUserSession(phoneNumber);
    if (!session.orderData.items || session.orderData.items.length === 0) {
      await sendTextMessage(phoneNumber, "Your cart is empty. Let's add some items first!");
      await handleOrderNow(phoneNumber);
      return;
    }
    await sendTextMessage(phoneNumber, `Great! Let's get your details to process the order.\n\nWhat's your full name? 👤`);
    updateUserSession(phoneNumber, { state: SESSION_STATES.WAITING_FOR_NAME });
}

async function handleNameInput(phoneNumber, name) {
    const session = getUserSession(phoneNumber);
    session.userData.name = name;
  
    const message = `Thanks ${name}!\n\nNow, how would you like to provide your complete pickup & delivery address? 📍`;
    const buttons = [
        { type: 'reply', reply: { id: 'type_address', title: '✍️ Type Address' } },
        { type: 'reply', reply: { id: 'share_location', title: '📍 Share Location' } }
    ];

    await sendInteractiveMessage(phoneNumber, message, buttons);
    updateUserSession(phoneNumber, { state: SESSION_STATES.WAITING_FOR_ADDRESS, userData: session.userData });
}

async function handleAddressInput(phoneNumber, input) {
    const session = getUserSession(phoneNumber);

    if (input === 'type_address') {
        await sendTextMessage(phoneNumber, 'Please type your full address now.');
        return; 
    }

    if (input === 'share_location') {
        await sendTextMessage(phoneNumber, 'Please use the (+) button in WhatsApp to share your live or current location.');
        return;
    }
    
    session.userData.address = input;
    const buttons = [
      { type: 'reply', reply: { id: 'cash', title: '💵 Cash on Delivery' } },
      { type: 'reply', reply: { id: 'upi', title: '📱 UPI (Online)' } }
    ];
    await sendInteractiveMessage(phoneNumber, `Perfect! Address noted.\n\nHow would you like to pay? 💳`, buttons);
    updateUserSession(phoneNumber, { state: SESSION_STATES.WAITING_FOR_PAYMENT, userData: session.userData });
}

async function handlePaymentMethod(phoneNumber, paymentMethod) {
    const session = getUserSession(phoneNumber);
    session.userData.paymentMethod = paymentMethod;
  
    const { items, total } = session.orderData;
    const paymentText = { 'cash': '💵 Cash on Delivery', 'upi': '📱 UPI (Online)' };
    let itemsList = items.map(item => `• ${item.name} (${item.quantity}x)`).join('\n');
    
    const message = `📋 *Please Confirm Your Order*\n\n*Items:*\n${itemsList}\n\n*Total:* ₹${total.toFixed(2)}\n*Payment:* ${paymentText[paymentMethod]}\n*Customer:* ${session.userData.name}\n*Address:* ${session.userData.address}\n\nIs this correct?`;
    
    const buttons = [
      { type: 'reply', reply: { id: 'place_order', title: '✅ Place Order' } },
      { type: 'reply', reply: { id: 'modify_order', title: '✏️ Modify' } }
    ];
    
    await sendInteractiveMessage(phoneNumber, message, buttons);
    updateUserSession(phoneNumber, { state: SESSION_STATES.ORDER_SUMMARY });
}
  
async function handlePlaceOrder(phoneNumber) {
    const session = getUserSession(phoneNumber);
    const orderNumber = `ORD${Date.now()}`;
    const orderData = {
      orderNumber,
      customerPhone: phoneNumber,
      customerName: session.userData.name,
      address: session.userData.address,
      items: session.orderData.items,
      total: session.orderData.total,
      paymentMethod: session.userData.paymentMethod,
      status: 'pending_vendor_confirmation',
      createdAt: new Date()
    };
  
    try {
      const savedOrder = await saveOrder(orderData);
      await sendTextMessage(phoneNumber, `🎉 Order placed successfully!\n\n*Order Number:* ${orderNumber}\n\nWe're now confirming with our vendor. Please wait... ⏳`);
      
      const assignedVendor = vendors[0];
      await assignVendorToOrder(savedOrder.insertedId, assignedVendor);
      
      let vendorItemsList = orderData.items.map(item => `• ${item.name} (${item.quantity}x)`).join('\n');
      const vendorMessage = `🆕 *New Order Received*\n\n*Order #:* ${orderNumber}\n*Customer:* ${orderData.customerName}\n*Phone:* ${phoneNumber}\n*Address:* ${orderData.address}\n\n*Items:*\n${vendorItemsList}\n\n*Total:* ₹${orderData.total.toFixed(2)}\n*Payment:* ${orderData.paymentMethod}`;
      const vendorButtons = [
        { type: 'reply', reply: { id: `accept_${orderNumber}`, title: '✅ Accept' } },
        { type: 'reply', reply: { id: `reject_${orderNumber}`, title: '❌ Reject' } }
      ];
      await sendInteractiveMessage(assignedVendor, vendorMessage, vendorButtons);
  
      delete sessions[phoneNumber]; // Reset session
  
    } catch (error) {
      console.error('❌ Error placing order:', error);
      await sendTextMessage(phoneNumber, '❌ Sorry, there was an error placing your order. Please try again.');
    }
}
  
// Main message handler
async function handleMessage(message) {
  const phoneNumber = message.from;

  console.log('--- Incoming Message ---');
  console.log(JSON.stringify(message, null, 2));

  if (message.type === 'order' && message.order) {
    console.log(`📦 Received cart from ${phoneNumber}. Processing...`);
    await handleCatalogSelection(phoneNumber, message.order);
    return;
  }
  
  // *** FIX: Added logic to handle incoming location messages ***
  if (message.type === 'location') {
      const session = getUserSession(phoneNumber);
      if (session.state === SESSION_STATES.WAITING_FOR_ADDRESS) {
          console.log(`📍 Received location from ${phoneNumber}.`);
          const address = `Location Pin: (Lat: ${message.location.latitude}, Long: ${message.location.longitude})`;
          await handleAddressInput(phoneNumber, address);
      }
      return;
  }

  const session = getUserSession(phoneNumber);
  let input = '';

  if (message.text?.body) {
    input = message.text.body.trim();
  } else if (message.interactive?.button_reply?.id) {
    input = message.interactive.button_reply.id;
  } else {
    console.log(`Ignoring non-actionable message type: ${message.type}`);
    return;
  }

  console.log(`📱 Message from ${phoneNumber}: "${input}", State: ${session.state}`);
  try {
    switch (session.state) {
      case SESSION_STATES.INITIAL:
        if (input === 'order_now') await handleOrderNow(phoneNumber);
        else await handleWelcomeMessage(phoneNumber);
        break;

      case SESSION_STATES.CATALOG_Browse:
        if (input === 'proceed_checkout') await handleProceedCheckout(phoneNumber);
        else if (input === 'add_more_items') await handleOrderNow(phoneNumber);
        else if (input === 'clear_cart') {
          session.orderData = { items: [], total: 0 };
          updateUserSession(phoneNumber, { orderData: session.orderData });
          await sendTextMessage(phoneNumber, '🗑️ Cart cleared!');
          await handleOrderNow(phoneNumber);
        }
        break;

      case SESSION_STATES.WAITING_FOR_NAME:
        await handleNameInput(phoneNumber, input);
        break;
      
      // *** FIX: Corrected typo from SESSION_ATES to SESSION_STATES ***
      case SESSION_STATES.WAITING_FOR_ADDRESS:
        await handleAddressInput(phoneNumber, input);
        break;

      case SESSION_STATES.WAITING_FOR_PAYMENT:
        if (['cash', 'upi'].includes(input)) await handlePaymentMethod(phoneNumber, input);
        else await sendTextMessage(phoneNumber, '❓ Please select a valid payment method.');
        break;

      case SESSION_STATES.ORDER_SUMMARY:
        if (input === 'place_order') await handlePlaceOrder(phoneNumber);
        else if (input === 'modify_order') {
          updateUserSession(phoneNumber, { state: SESSION_STATES.CATALOG_Browse });
          await showCartSummary(phoneNumber);
        }
        break;

      default:
        await handleWelcomeMessage(phoneNumber);
    }
  } catch (error) {
    console.error('❌ Error in state machine:', error);
    await sendTextMessage(phoneNumber, '❌ Oops! Something went wrong. Please type "hi" to restart.');
  }
}

// Webhook setup
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message) {
      handleMessage(message).catch(err => console.error("Error handling message:", err));
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(port, () => console.log(`🚀 Server is running on port ${port}`));