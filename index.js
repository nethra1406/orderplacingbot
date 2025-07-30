// index.js - Final Version with Dual Role Functionality

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const {
  saveOrder, connectDB, assignVendorToOrder, getOrderByNumber,
  updateOrderStatus, getVendorByPhone, getUserByPhone, getDB
} = require('./db');

const app = express();
const port = process.env.PORT || 10000;
app.use(bodyParser.json());

const {
  PHONE_NUMBER_ID, ACCESS_TOKEN, VERIFY_TOKEN,
  VENDOR_PHONE_1, DELIVERY_PARTNER_PHONE, ADMIN_PHONE, CATALOG_ID
} = process.env;

connectDB().catch(err => console.error('❌ Database connection failed:', err));

const sessions = {};
const SESSION_STATES = {
  INITIAL: 'initial', CATALOG_Browse: 'catalog_Browse',
  WAITING_FOR_NAME: 'waiting_for_name', WAITING_FOR_ADDRESS: 'waiting_for_address',
  WAITING_FOR_PAYMENT: 'waiting_for_payment', ORDER_SUMMARY: 'order_summary',
};

// --- UTILITY & API FUNCTIONS ---
function getUserSession(phoneNumber) {
  if (!sessions[phoneNumber]) {
    sessions[phoneNumber] = {
      state: SESSION_STATES.INITIAL, userData: {}, orderData: { items: new Map() },
    };
  }
  return sessions[phoneNumber];
}

async function sendTextMessage(to, message) {
    const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } };
    try {
        await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, payload, { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` } });
        console.log(`✅ Text message sent to ${to}`);
    } catch (error) { console.error(`❌ Error sending text to ${to}:`, error.response?.data || error.message); }
}

async function sendInteractiveMessage(to, message, buttons) {
    const payload = { messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'button', body: { text: message }, action: { buttons: buttons } } };
    try {
        await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, payload, { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` } });
        console.log(`✅ Interactive message sent to ${to}`);
    } catch (error) { console.error(`❌ Error sending interactive to ${to}:`, error.response?.data || error.message); throw error; }
}

async function sendCatalog(to) {
    const payload = { messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'catalog_message', body: { text: '🧺 Please browse our services and select what you need!' }, action: { name: 'catalog_message', catalog_id: CATALOG_ID } } };
    try {
        await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, payload, { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` } });
        console.log(`✅ Catalog sent to ${to}`);
    } catch (error) { console.error('❌ Error sending catalog:', error.response?.data || error.message); }
}

async function getProductDetails(productId) {
    try {
        const url = `https://graph.facebook.com/v20.0/${productId}?fields=name,price&access_token=${ACCESS_TOKEN}`;
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(`❌ Product details error (likely permissions): ${productId}`);
        return null;
    }
}


// --- WORKFLOW & STATE MANAGEMENT ---
function generateTimeline(status) {
    const timelineSteps = [
        { state: 'vendor_accepted', text: 'Order Accepted' },
        { state: 'processing_at_facility', text: 'Items Collected & Processing' },
        { state: 'out_for_delivery', text: 'Out for Delivery' },
        { state: 'completed', text: 'Delivered' }
    ];
    let timelineMessage = '📊 *Your Order Timeline*\n\n';
    let currentStateFound = false;
    for (const step of timelineSteps) {
        if (step.state === status) {
            timelineMessage += `➡️ *${step.text}*\n`;
            currentStateFound = true;
        } else if (currentStateFound) {
            timelineMessage += `⚪️ ${step.text}\n`;
        } else {
            timelineMessage += `✅ ${step.text}\n`;
        }
    }
    return timelineMessage;
}

async function processVendorResponse(vendorPhone, orderNumber, action) {
    const order = await getOrderByNumber(orderNumber);
    if (!order) return await sendTextMessage(vendorPhone, `⚠️ Order #${orderNumber} not found.`);
    
    if (action === 'accept') {
        await updateOrderStatus(order._id, 'vendor_accepted', { vendorId: vendorPhone });
        await sendTextMessage(vendorPhone, `✅ You accepted Order #${orderNumber}.`);
        await sendTextMessage(order.customerPhone, `🎉 Great news! Your order #${orderNumber} has been accepted.\n\nPickup is scheduled within the next 60 minutes.`);
        if (DELIVERY_PARTNER_PHONE) {
            const buttons = [{ type: 'reply', reply: { id: `picked_up_${orderNumber}`, title: '👍 Confirm Pickup' } }];
            await sendInteractiveMessage(DELIVERY_PARTNER_PHONE, `🚛 New Pickup Assignment!\n\n*Order #:* ${orderNumber}\n*Customer:* ${order.customerName}\n*Address:* ${order.address}`, buttons);
        }
    } else { // 'reject'
        await updateOrderStatus(order._id, 'vendor_rejected');
        await sendTextMessage(vendorPhone, `❌ You rejected Order #${orderNumber}.`);
        await sendTextMessage(order.customerPhone, `⚠️ We're sorry, your order #${orderNumber} could not be processed right now.`);
        if (ADMIN_PHONE) await sendTextMessage(ADMIN_PHONE, `🚨 Vendor ${vendorPhone} REJECTED order #${orderNumber}.`);
    }
}

async function processDeliveryPartnerUpdate(deliveryPartnerPhone, orderNumber, status) {
    const order = await getOrderByNumber(orderNumber);
    if (!order) return await sendTextMessage(deliveryPartnerPhone, `⚠️ Order #${orderNumber} not found.`);

    if (status === 'picked_up') {
        await updateOrderStatus(order._id, 'processing_at_facility', { deliveryPartnerId: deliveryPartnerPhone });
        await sendTextMessage(deliveryPartnerPhone, `✅ Pickup confirmed for #${orderNumber}.`);
        await sendTextMessage(order.customerPhone, `📦 Your items for order #${orderNumber} have been collected!`);
    } else if (status === 'delivered') {
        await updateOrderStatus(order._id, 'completed');
        await sendTextMessage(deliveryPartnerPhone, `✅ Delivery for #${orderNumber} confirmed.`);
        await sendTextMessage(order.customerPhone, `✅ Your order #${orderNumber} has been delivered!`);
        
        const buttons = [
            { type: 'reply', reply: { id: `feedback_5_${orderNumber}`, title: '⭐️⭐️⭐️⭐️⭐️' } },
            { type: 'reply', reply: { id: `feedback_4_${orderNumber}`, title: '⭐️⭐️⭐️⭐️' } },
            { type: 'reply', reply: { id: `feedback_3_${orderNumber}`, title: '⭐️⭐️⭐️' } },
        ];
        await sendInteractiveMessage(order.customerPhone, "Please take a moment to rate our service:", buttons);
    }
}

// --- Customer-Facing Handlers ---
async function handleWelcomeMessage(phoneNumber) {
    const user = await getUserByPhone(phoneNumber);
    if (!user || !user.isVerified) {
      return await sendTextMessage(phoneNumber, '❌ Sorry, this service is for verified numbers only.');
    }
    const welcomeMessage = `🙏 Welcome to *Wrinkl*!\n\nHow can we help?`;
    const buttons = [{ type: 'reply', reply: { id: 'order_now', title: '🛍️ Place Order' } }];
    await sendInteractiveMessage(phoneNumber, welcomeMessage, buttons);
    getUserSession(phoneNumber).state = SESSION_STATES.INITIAL;
}

async function handleOrderNow(phoneNumber) {
    await sendCatalog(phoneNumber);
    await sendTextMessage(phoneNumber, `👆 Please browse our catalog above and send your cart when ready.`);
    getUserSession(phoneNumber).state = SESSION_STATES.CATALOG_Browse;
}

async function handleCatalogSelection(phoneNumber, orderPayload) {
    const session = getUserSession(phoneNumber);
    const existingItems = session.orderData.items;

    for (const item of orderPayload.product_items) {
        const productId = item.product_retailer_id;
        const quantity = parseInt(item.quantity, 10) || 1;
        if (existingItems.has(productId)) {
            existingItems.get(productId).quantity += quantity;
        } else {
            const details = await getProductDetails(productId);
            existingItems.set(productId, {
                name: details ? details.name : 'Selected Item',
                quantity: quantity,
                price: parseFloat(item.item_price)
            });
        }
    }
    await showCartSummary(phoneNumber);
}

async function showCartSummary(phoneNumber) {
    const itemsMap = getUserSession(phoneNumber).orderData.items;
    if (!itemsMap || itemsMap.size === 0) return await sendTextMessage(phoneNumber, '🛒 Your cart is empty.');

    let itemsList = [], total = 0, index = 1;
    for (const item of itemsMap.values()) {
        const itemTotal = item.price * item.quantity;
        itemsList.push(`${index}. ${item.name}\n   Qty: ${item.quantity} × ₹${item.price.toFixed(2)} = ₹${itemTotal.toFixed(2)}`);
        total += itemTotal;
        index++;
    }
    const summaryMessage = `🛒 *Your Cart Summary:*\n\n${itemsList.join('\n\n')}\n\n*Total Amount: ₹${total.toFixed(2)}*`;
    const buttons = [
        { type: 'reply', reply: { id: 'proceed_checkout', title: '✅ Checkout' } },
        { type: 'reply', reply: { id: 'add_more_items', title: '➕ Add More' } },
        { type: 'reply', reply: { id: 'clear_cart', title: '🗑️ Clear Cart' } }
    ];
    await sendInteractiveMessage(phoneNumber, summaryMessage, buttons);
}

async function handleProceedCheckout(phoneNumber) {
    await sendTextMessage(phoneNumber, `Great! What's your full name? 👤`);
    getUserSession(phoneNumber).state = SESSION_STATES.WAITING_FOR_NAME;
}

async function handleNameInput(phoneNumber, name) {
    const session = getUserSession(phoneNumber);
    session.userData.name = name;
    const buttons = [{ type: 'reply', reply: { id: 'type_address', title: '✍️ Type Address' } }, { type: 'reply', reply: { id: 'share_location', title: '📍 Share Location' } }];
    await sendInteractiveMessage(phoneNumber, `Thanks ${name}!\n\nHow would you like to provide your address? 📍`, buttons);
    session.state = SESSION_STATES.WAITING_FOR_ADDRESS;
}

async function handleAddressInput(phoneNumber, input) {
    if (input === 'type_address' || input === 'share_location') {
        return await sendTextMessage(phoneNumber, input === 'type_address' ? 'Please type your full address now.' : 'Please use the (+) button to share your location.');
    }
    const session = getUserSession(phoneNumber);
    session.userData.address = input;
    const buttons = [{ type: 'reply', reply: { id: 'cash', title: '💵 Cash' } }, { type: 'reply', reply: { id: 'upi', title: '📱 UPI' } }];
    await sendInteractiveMessage(phoneNumber, `Got it! How would you like to pay? 💳`, buttons);
    session.state = SESSION_STATES.WAITING_FOR_PAYMENT;
}

async function handlePaymentMethod(phoneNumber, paymentMethod) {
    const session = getUserSession(phoneNumber);
    session.userData.paymentMethod = paymentMethod;
    const itemsMap = session.orderData.items;
    let total = 0, itemsList = [];
    for (const item of itemsMap.values()) {
        itemsList.push(`• ${item.name} (Qty: ${item.quantity})`);
        total += item.price * item.quantity;
    }
    const message = `📋 *Please Confirm Your Order*\n\n*Items:*\n${itemsList.join('\n')}\n\n*Total:* ₹${total.toFixed(2)}\n*Payment:* ${paymentMethod.toUpperCase()}\n*Customer:* ${session.userData.name}\n*Address:* ${session.userData.address}`;
    const buttons = [{ type: 'reply', reply: { id: 'place_order', title: '✅ Yes, Place Order' } }, { type: 'reply', reply: { id: 'modify_order', title: '✏️ No, Modify' } }];
    await sendInteractiveMessage(phoneNumber, message, buttons);
    session.state = SESSION_STATES.ORDER_SUMMARY;
}

async function handlePlaceOrder(phoneNumber) {
    const session = getUserSession(phoneNumber);
    let total = 0;
    const itemsForDb = Array.from(session.orderData.items.values()).map(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        return { ...item, total: itemTotal };
    });
    const orderData = {
        orderNumber: `ORD${Date.now()}`, customerPhone: phoneNumber,
        customerName: session.userData.name, address: session.userData.address,
        paymentMethod: session.userData.paymentMethod, items: itemsForDb, total: total,
        status: 'pending_vendor_confirmation', createdAt: new Date(),
    };
    try {
        const savedOrder = await saveOrder(orderData);
        await sendTextMessage(phoneNumber, `✅ Order placed successfully!\n*Order #:* ${orderData.orderNumber}\n\nYou'll get a confirmation message once our vendor accepts the order. ⏱️`);
        await assignVendorToOrder(savedOrder.insertedId, VENDOR_PHONE_1);
        let vendorItemsList = orderData.items.map(item => `• ${item.name} (x${item.quantity})`).join('\n');
        const vendorMessage = `🆕 *New Order Received*\n\n*Order #:* ${orderData.orderNumber}\n*Customer:* ${orderData.customerName}\n*Address:* ${orderData.address}\n*Total:* ₹${orderData.total.toFixed(2)}`;
        const vendorButtons = [{ type: 'reply', reply: { id: `accept_${orderData.orderNumber}`, title: '✅ Accept' } }, { type: 'reply', reply: { id: `reject_${orderData.orderNumber}`, title: '❌ Reject' } }];
        await sendInteractiveMessage(VENDOR_PHONE_1, vendorMessage, vendorButtons);
        // Reset session for next order
        session.state = SESSION_STATES.INITIAL;
        session.orderData = { items: new Map() };
        session.userData = {};
    } catch (error) {
        console.error('❌ Error placing order:', error);
        await sendTextMessage(phoneNumber, '❌ Sorry, there was an error placing your order.');
    }
}

// --- MAIN MESSAGE ROUTER ---
async function handleMessage(message) {
    const phoneNumber = message.from;
    const msgBody = message.text?.body?.trim().toLowerCase();
    const btnId = message.interactive?.button_reply?.id;
    const input = btnId || msgBody;

    // This flag will track if we performed an operator-specific action
    let isOperatorAction = false;

    // --- Operator Workflow Check ---
    if (btnId) {
        const vendor = await getVendorByPhone(phoneNumber);
        if (vendor && (btnId.startsWith('accept_') || btnId.startsWith('reject_'))) {
            const [action, orderNumber] = btnId.split('_');
            await processVendorResponse(phoneNumber, orderNumber, action);
            isOperatorAction = true;
        }
        if (phoneNumber === DELIVERY_PARTNER_PHONE && (btnId.startsWith('picked_up_') || btnId.startsWith('delivered_'))) {
            const [status, orderNumber] = btnId.split(/_(.+)/);
            await processDeliveryPartnerUpdate(phoneNumber, orderNumber, status);
            isOperatorAction = true;
        }
    }
    if (phoneNumber === DELIVERY_PARTNER_PHONE && msgBody && msgBody.startsWith('deliver ')) {
        const [, orderNumber] = msgBody.split(' ');
        const order = await getOrderByNumber(orderNumber);
        if(order) {
            await updateOrderStatus(order._id, 'out_for_delivery');
            await sendTextMessage(order.customerPhone, `🚚 Good news! Your order #${orderNumber} is out for delivery and should arrive within 60 minutes.`);
            const buttons = [{ type: 'reply', reply: { id: `delivered_${orderNumber}`, title: '✅ Confirm Delivery' } }];
            await sendInteractiveMessage(phoneNumber, `🚀 Starting delivery for #${orderNumber}.`, buttons);
        }
        isOperatorAction = true;
    }

    // If we performed an operator action, stop here.
    if (isOperatorAction) {
        return;
    }

    // --- Customer Workflow (Runs if no operator action was taken) ---
    if (!input && message.type !== 'order' && message.type !== 'location') return;

    if (message.type === 'order') return await handleCatalogSelection(phoneNumber, message.order);
    if (message.type === 'location') {
        if (getUserSession(phoneNumber).state === SESSION_STATES.WAITING_FOR_ADDRESS) {
            return await handleAddressInput(phoneNumber, `Location Pin: (Lat: ${message.location.latitude}, Long: ${message.location.longitude})`);
        }
    }
    if (btnId && btnId.startsWith('feedback_')) {
        const [, rating, orderNumber] = btnId.split('_');
        // In a real app, you would save this feedback to the order document
        console.log(`Received feedback for ${orderNumber}: ${rating} stars.`);
        return await sendTextMessage(phoneNumber, "🙏 Thank you for your valuable feedback!");
    }
    if (msgBody === 'track' || msgBody === 'track order') {
        const db = getDB();
        const orders = await db.collection('orders').find({ customerPhone: phoneNumber, status: { $nin: ['completed', 'vendor_rejected', 'pending_vendor_confirmation'] } }).sort({ createdAt: -1 }).limit(1).toArray();
        if (orders.length > 0) return await sendTextMessage(phoneNumber, generateTimeline(orders[0].status));
        return await sendTextMessage(phoneNumber, "You have no active orders to track right now.");
    }

    const session = getUserSession(phoneNumber);
    try {
        switch (session.state) {
            case SESSION_STATES.INITIAL:
                input === 'order_now' ? await handleOrderNow(phoneNumber) : await handleWelcomeMessage(phoneNumber);
                break;
            case SESSION_STATES.CATALOG_Browse:
                if (input === 'proceed_checkout') await handleProceedCheckout(phoneNumber);
                else if (input === 'add_more_items') await handleOrderNow(phoneNumber);
                else if (input === 'clear_cart') {
                    session.orderData.items.clear();
                    await sendTextMessage(phoneNumber, '🗑️ Cart cleared!');
                    await handleOrderNow(phoneNumber);
                }
                break;
            case SESSION_STATES.WAITING_FOR_NAME: await handleNameInput(phoneNumber, input); break;
            case SESSION_STATES.WAITING_FOR_ADDRESS: await handleAddressInput(phoneNumber, input); break;
            case SESSION_STATES.WAITING_FOR_PAYMENT:
                if (['cash', 'upi'].includes(input)) await handlePaymentMethod(phoneNumber, input);
                else await sendTextMessage(phoneNumber, '❓ Please select a valid payment method.');
                break;
            case SESSION_STATES.ORDER_SUMMARY:
                if (input === 'place_order') await handlePlaceOrder(phoneNumber);
                else if (input === 'modify_order') {
                    session.state = SESSION_STATES.CATALOG_Browse;
                    await showCartSummary(phoneNumber);
                }
                break;
            default: await handleWelcomeMessage(phoneNumber);
        }
    } catch (error) {
        console.error('❌ State machine error:', error);
        await sendTextMessage(phoneNumber, '❌ Oops! Something went wrong. Please type "hi" to restart.');
    }
}

// --- Webhook Setup ---
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else { res.sendStatus(403); }
});

app.post('/webhook', (req, res) => {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (req.body.object === 'whatsapp_business_account' && message) {
        handleMessage(message).catch(err => console.error("Message handler promise rejected:", err));
    }
    res.sendStatus(200);
});

app.listen(port, () => console.log(`🚀 Server is running on port ${port}`));