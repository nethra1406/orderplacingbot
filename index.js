require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const {
  saveOrder,
  connectDB,
  assignVendorToOrder,
  getOrderByNumber,     // <-- IMPORTED
  updateOrderStatus,    // <-- IMPORTED
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
  DELIVERY_PARTNER_PHONE, // <-- ADDED
  ADMIN_PHONE,            // <-- ADDED
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

// --- Utility Functions ---
function getUserSession(phoneNumber) {
  if (!sessions[phoneNumber]) {
    sessions[phoneNumber] = {
      state: SESSION_STATES.INITIAL,
      userData: {},
      orderData: { items: [], total: 0 },
    };
  }
  return sessions[phoneNumber];
}

function updateUserSession(phoneNumber, updates) {
  const session = getUserSession(phoneNumber);
  Object.assign(session, updates);
  sessions[phoneNumber] = session;
}

// --- WhatsApp API Functions ---
async function sendTextMessage(to, message) {
    const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } };
    try {
      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, payload, {
        headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
      });
      console.log(`✅ Text message sent to ${to}`);
    } catch (error) {
      console.error(`❌ Error sending text to ${to}:`, error.response?.data || error.message);
    }
}

async function sendInteractiveMessage(to, message, buttons) {
    const payload = {
      messaging_product: 'whatsapp', to, type: 'interactive',
      interactive: { type: 'button', body: { text: message }, action: { buttons: buttons } }
    };
    try {
      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, payload, {
        headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
      });
      console.log(`✅ Interactive message sent to ${to}`);
    } catch (error) {
      console.error(`❌ Error sending interactive message to ${to}:`, error.response?.data || error.message);
      throw error;
    }
}

async function sendCatalog(to) {
    const payload = {
      messaging_product: 'whatsapp', to, type: 'interactive',
      interactive: {
        type: 'catalog_message',
        body: { text: '🧺 Please browse our services and select what you need!' },
        action: { name: 'catalog_message', catalog_id: CATALOG_ID }
      }
    };
    try {
      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, payload, {
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
      console.error(`❌ Error fetching product details for ${productId}. This is likely an ACCESS TOKEN permission issue.`);
      return null;
    }
}

// --- NEW VENDOR WORKFLOW ---
async function processVendorResponse(vendorPhone, orderNumber, action) {
    const order = await getOrderByNumber(orderNumber);
    if (!order) {
        console.error(`❌ Vendor responded for a non-existent order: ${orderNumber}`);
        await sendTextMessage(vendorPhone, `⚠️ Order #${orderNumber} not found.`);
        return;
    }
  
    const customerPhone = order.customerPhone;
    const deliveryPhone = DELIVERY_PARTNER_PHONE;
  
    if (action === 'accept') {
        await updateOrderStatus(order._id, 'vendor_accepted');
  
        // 1. Confirm to Vendor
        await sendTextMessage(vendorPhone, `✅ You have accepted Order #${orderNumber}.\nPlease coordinate with the delivery partner for pickup.`);
  
        // 2. Notify Customer
        const customerMessage = `🎉 Great news! Your order #${orderNumber} has been accepted.\n\nOur team is preparing for pickup and you will be notified again shortly.`;
        await sendTextMessage(customerPhone, customerMessage);
  
        // 3. Notify Delivery Partner
        if (deliveryPhone) {
            const deliveryMessage = `🚛 New Pickup Assignment!\n\n*Order #:* ${orderNumber}\n*Customer:* ${order.customerName}\n*Address:* ${order.address}\n*Total Items:* ${order.items.length}\n\nPlease coordinate with the vendor at ${vendorPhone} for pickup.`;
            await sendTextMessage(deliveryPhone, deliveryMessage);
        }
  
    } else if (action === 'reject') {
        await updateOrderStatus(order._id, 'vendor_rejected');
  
        // 1. Inform Vendor
        await sendTextMessage(vendorPhone, `❌ You have rejected Order #${orderNumber}.`);
  
        // 2. Inform Customer
        const customerMessage = `⚠️ We're sorry, your order #${orderNumber} could not be processed at this moment.\nPlease contact support for assistance.`;
        await sendTextMessage(customerPhone, customerMessage);
  
        // 3. Inform Admin
        if (ADMIN_PHONE) {
            await sendTextMessage(ADMIN_PHONE, `🚨 Vendor ${vendorPhone} REJECTED order #${orderNumber}. Manual follow-up needed.`);
        }
    }
}

// --- Customer-Facing Handlers ---
async function handleWelcomeMessage(phoneNumber) {
    const welcomeMessage = `🙏 Welcome to *Wrinkl*!\n\nPremium laundry services at your doorstep. How can we help?`;
    const buttons = [{ type: 'reply', reply: { id: 'order_now', title: '🛍️ Place Order' } }, { type: 'reply', reply: { id: 'contact_us', title: '📞 Contact Us' } }];
    await sendInteractiveMessage(phoneNumber, welcomeMessage, buttons);
    updateUserSession(phoneNumber, { state: SESSION_STATES.INITIAL });
}

async function handleOrderNow(phoneNumber) {
    await sendCatalog(phoneNumber);
    const message = `👆 Please browse our catalog above.\n\nSend your cart to us when you're ready to proceed.`;
    await sendTextMessage(phoneNumber, message);
    updateUserSession(phoneNumber, { state: SESSION_STATES.CATALOG_Browse });
}

async function handleCatalogSelection(phoneNumber, orderPayload) {
    const session = getUserSession(phoneNumber);
    let items = [];
    let total = 0;
    for (const item of orderPayload.product_items) {
        const details = await getProductDetails(item.product_retailer_id);
        const itemName = details ? details.name : 'Selected Item';
        const itemPrice = parseFloat(item.item_price);
        const quantity = parseInt(item.quantity, 10) || 1;
        items.push({ name: itemName, quantity, price: itemPrice, total: itemPrice * quantity });
        total += itemPrice * quantity;
    }
    session.orderData = { items, total };
    updateUserSession(phoneNumber, { orderData: session.orderData });
    await showCartSummary(phoneNumber);
}

async function showCartSummary(phoneNumber) {
    const { items, total } = getUserSession(phoneNumber).orderData;
    if (!items || items.length === 0) {
        await sendTextMessage(phoneNumber, '🛒 Your cart is empty.');
        return;
    }
    let itemsList = items.map((item, i) => `${i + 1}. ${item.name}\n   Qty: ${item.quantity} × ₹${item.price.toFixed(2)} = ₹${item.total.toFixed(2)}`).join('\n\n');
    const summaryMessage = `🛒 *Your Cart Summary:*\n\n${itemsList}\n\n*Total Amount: ₹${total.toFixed(2)}*`;
    const buttons = [
        { type: 'reply', reply: { id: 'proceed_checkout', title: '✅ Checkout' } },
        { type: 'reply', reply: { id: 'add_more_items', title: '➕ Add More' } },
        { type: 'reply', reply: { id: 'clear_cart', title: '🗑️ Clear Cart' } }
    ];
    await sendInteractiveMessage(phoneNumber, summaryMessage, buttons);
}

async function handleProceedCheckout(phoneNumber) {
    await sendTextMessage(phoneNumber, `Great! Let's get your details.\n\nWhat's your full name? 👤`);
    updateUserSession(phoneNumber, { state: SESSION_STATES.WAITING_FOR_NAME });
}

async function handleNameInput(phoneNumber, name) {
    const session = getUserSession(phoneNumber);
    session.userData.name = name;
    const message = `Thanks ${name}!\n\nHow would you like to provide your address? 📍`;
    const buttons = [{ type: 'reply', reply: { id: 'type_address', title: '✍️ Type Address' } }, { type: 'reply', reply: { id: 'share_location', title: '📍 Share Location' } }];
    await sendInteractiveMessage(phoneNumber, message, buttons);
    updateUserSession(phoneNumber, { state: SESSION_STATES.WAITING_FOR_ADDRESS, userData: session.userData });
}

async function handleAddressInput(phoneNumber, input) {
    if (input === 'type_address') {
        await sendTextMessage(phoneNumber, 'Please type your full address now.');
        return;
    }
    if (input === 'share_location') {
        await sendTextMessage(phoneNumber, 'Please use the (+) button in WhatsApp to share your location.');
        return;
    }
    const session = getUserSession(phoneNumber);
    session.userData.address = input;
    const buttons = [{ type: 'reply', reply: { id: 'cash', title: '💵 Cash' } }, { type: 'reply', reply: { id: 'upi', title: '📱 UPI (Online)' } }];
    await sendInteractiveMessage(phoneNumber, `Got it! How would you like to pay? 💳`, buttons);
    updateUserSession(phoneNumber, { state: SESSION_STATES.WAITING_FOR_PAYMENT, userData: session.userData });
}

async function handlePaymentMethod(phoneNumber, paymentMethod) {
    const session = getUserSession(phoneNumber);
    session.userData.paymentMethod = paymentMethod;
    const { items, total } = session.orderData;
    const paymentText = { 'cash': '💵 Cash', 'upi': '📱 UPI (Online)' };
    let itemsList = items.map(item => `• ${item.name} (Qty: ${item.quantity})`).join('\n');
    const message = `📋 *Please Confirm Your Order*\n\n*Items:*\n${itemsList}\n\n*Total:* ₹${total.toFixed(2)}\n*Payment:* ${paymentText[paymentMethod]}\n*Customer:* ${session.userData.name}\n*Address:* ${session.userData.address}\n\nIs this correct?`;
    const buttons = [{ type: 'reply', reply: { id: 'place_order', title: '✅ Yes, Place Order' } }, { type: 'reply', reply: { id: 'modify_order', title: '✏️ No, Modify' } }];
    await sendInteractiveMessage(phoneNumber, message, buttons);
    updateUserSession(phoneNumber, { state: SESSION_STATES.ORDER_SUMMARY });
}

async function handlePlaceOrder(phoneNumber) {
    const session = getUserSession(phoneNumber);
    const orderNumber = `ORD${Date.now()}`;
    const orderData = { orderNumber, customerPhone: phoneNumber, ...session.userData, ...session.orderData, status: 'pending_vendor_confirmation', createdAt: new Date() };

    try {
        const savedOrder = await saveOrder(orderData);
        await sendTextMessage(phoneNumber, `✅ Order placed successfully!\n*Order #:* ${orderNumber}\n\nYour order is now with our vendor for confirmation. You'll receive an update shortly! ⏱️`);
        const assignedVendor = vendors[0];
        await assignVendorToOrder(savedOrder.insertedId, assignedVendor);

        let vendorItemsList = orderData.items.map(item => `• ${item.name} (x${item.quantity})`).join('\n');
        const vendorMessage = `🆕 *New Order Received*\n\n*Order #:* ${orderNumber}\n*Customer:* ${orderData.name}\n*Phone:* ${phoneNumber}\n*Address:* ${orderData.address}\n\n*Items:*\n${vendorItemsList}\n\n*Total:* ₹${orderData.total.toFixed(2)}\n*Payment:* ${orderData.paymentMethod}`;
        const vendorButtons = [{ type: 'reply', reply: { id: `accept_${orderNumber}`, title: '✅ Accept' } }, { type: 'reply', reply: { id: `reject_${orderNumber}`, title: '❌ Reject' } }];
        await sendInteractiveMessage(assignedVendor, vendorMessage, vendorButtons);

        delete sessions[phoneNumber];
    } catch (error) {
        console.error('❌ Error placing order:', error);
        await sendTextMessage(phoneNumber, '❌ Sorry, there was an error placing your order.');
    }
}

// --- Main Message Router ---
async function handleMessage(message) {
    const phoneNumber = message.from;

    if (vendors.includes(phoneNumber) && message.interactive?.button_reply?.id) {
        const buttonId = message.interactive.button_reply.id;
        if (buttonId.startsWith('accept_') || buttonId.startsWith('reject_')) {
            const [action, orderNumber] = buttonId.split('_');
            await processVendorResponse(phoneNumber, orderNumber, action);
            return;
        }
    }
    
    if (message.type === 'order') {
        await handleCatalogSelection(phoneNumber, message.order);
        return;
    }
    
    if (message.type === 'location') {
        const session = getUserSession(phoneNumber);
        if (session.state === SESSION_STATES.WAITING_FOR_ADDRESS) {
            const address = `Location Pin: (Lat: ${message.location.latitude}, Long: ${message.location.longitude})`;
            await handleAddressInput(phoneNumber, address);
        }
        return;
    }

    const session = getUserSession(phoneNumber);
    const input = message.text?.body.trim() || message.interactive?.button_reply?.id;
    if (!input) return;

    console.log(`📱 Message from ${phoneNumber}: "${input}", State: ${session.state}`);
    try {
        switch (session.state) {
            case SESSION_STATES.INITIAL:
                input === 'order_now' ? await handleOrderNow(phoneNumber) : await handleWelcomeMessage(phoneNumber);
                break;
            case SESSION_STATES.CATALOG_Browse:
                if (input === 'proceed_checkout') await handleProceedCheckout(phoneNumber);
                else if (input === 'add_more_items') await handleOrderNow(phoneNumber);
                else if (input === 'clear_cart') {
                    updateUserSession(phoneNumber, { orderData: { items: [], total: 0 } });
                    await sendTextMessage(phoneNumber, '🗑️ Cart cleared!');
                    await handleOrderNow(phoneNumber);
                }
                break;
            case SESSION_STATES.WAITING_FOR_NAME:
                await handleNameInput(phoneNumber, input);
                break;
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
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (req.body.object === 'whatsapp_business_account' && message) {
        handleMessage(message).catch(err => console.error("Error handling message:", err));
    }
    res.sendStatus(200);
});

app.listen(port, () => console.log(`🚀 Server is running on port ${port}`));