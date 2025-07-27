// index.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { 
    connectDB, 
    seedDatabase,
    saveOrUpdateOrder, 
    getOrder,
    findNearestVendor,
    findAvailableDeliveryPartner
} = require('./db');

const app = express();
const port = process.env.PORT || 10000;
app.use(bodyParser.json());

const sessions = {};
const VENDOR_PHONE_1 = process.env.VENDOR_PHONE_1;
const DELIVERY_PARTNER_PHONE = process.env.DELIVERY_PARTNER_PHONE;

// ================== WEBHOOK ==================

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log('✅ WEBHOOK_VERIFIED');
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;

    // ==> ROUTE TO PROXY HANDLERS IF THE SENDER IS A VENDOR OR DP <==
    if (from === VENDOR_PHONE_1) {
        await handleVendorMessage(from, message);
        return res.sendStatus(200);
    }
    if (from === DELIVERY_PARTNER_PHONE) {
        await handleDeliveryPartnerMessage(from, message);
        return res.sendStatus(200);
    }
    // ==> END PROXY ROUTING <==

    const session = sessions[from] || { step: 'greet' };
    const messageType = message.type;
    let userInput = '';

    if (messageType === 'text') {
        userInput = message.text.body.trim().toLowerCase();
    } else if (messageType === 'interactive') {
        userInput = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
    } else if (messageType === 'location') {
        session.location = message.location;
    }

    try {
        switch (session.step) {
            case 'greet':
                await sendWelcomeMenu(from);
                session.step = 'wait_initial_choice';
                break;

            case 'wait_initial_choice':
                if (userInput === 'order_now') {
                    await sendCatalogMenu(from);
                    session.step = 'ordering_catalog';
                } else if (userInput === 'contact_us') {
                    await sendText(from, 'You can reach us at support@yourfoodapp.com or call +91-1234567890.');
                    session.step = 'greet'; // Reset
                } else { // Help or misunderstood
                    await sendText(from, 'Use the buttons to navigate. Select "Order Now" to see our menu!');
                }
                break;

            case 'ordering_catalog':
                if (messageType === 'order') {
                    const orderId = `ORD-${Date.now()}`;
                    session.order = {
                        orderId,
                        customerPhone: from,
                        cart: message.order.product_items,
                        total: message.order.product_items.reduce((sum, item) => sum + (item.item_price * item.quantity), 0),
                        status: 'initiated',
                        createdAt: new Date()
                    };
                    await saveOrUpdateOrder(session.order);
                    await requestUserLocation(from);
                    session.step = 'get_location';
                } else {
                    await sendText(from, "Please choose items from our menu by clicking 'View items' and submit your cart.");
                }
                break;

            case 'get_location':
                if (session.location) {
                    const { latitude, longitude } = session.location;
                    const nearestVendor = await findNearestVendor([longitude, latitude]);

                    if (!nearestVendor) {
                        await sendText(from, "We're sorry, we couldn't find a restaurant that delivers to your location at the moment.");
                        delete sessions[from];
                        break;
                    }
                    
                    session.order.vendor = { name: nearestVendor.name, phone: nearestVendor.phone };
                    session.order.status = 'pending_vendor_acceptance';
                    session.order.location = session.location;
                    await saveOrUpdateOrder(session.order);
                    
                    await sendOrderToVendor(nearestVendor.phone, session.order);
                    await sendText(from, `Great! We've found a restaurant nearby: *${nearestVendor.name}*.\n\nWe're just waiting for them to confirm your order. We'll notify you in a moment!`);
                    session.step = 'awaiting_vendor_acceptance';
                } else {
                    await sendText(from, "Please share your location using the button so we can find the nearest restaurant for you.");
                }
                break;

            // Further steps are triggered by proxy handlers, not direct user input.
        }

        sessions[from] = session;
    } catch (error) {
        console.error('Error processing user message:', error);
    }

    res.sendStatus(200);
});

// ================== PROXY HANDLERS ==================

async function handleVendorMessage(from, message) {
    const text = message.text?.body?.toLowerCase() || '';
    const [command, orderId] = text.split(' ');

    if (!orderId) return;

    const order = await getOrder(orderId.toUpperCase());
    if (!order) return;

    if (command === 'accept') {
        order.status = 'confirmed_by_vendor';
        await saveOrUpdateOrder(order);

        // Notify user
        await sendText(order.customerPhone, `✅ Good news! *${order.vendor.name}* has accepted your order *${order.orderId}*.\n\nEstimated preparation time is 15-20 minutes. We're now assigning a delivery partner.`);
        
        // Find and notify delivery partner
        const dp = await findAvailableDeliveryPartner();
        if (dp) {
            order.deliveryPartner = { name: dp.name, phone: dp.phone };
            order.status = 'awaiting_pickup';
            await saveOrUpdateOrder(order);
            await sendOrderToDeliveryPartner(dp.phone, order);
            await sendText(order.customerPhone, `🛵 A delivery partner, *${dp.name}*, has been assigned to your order!`);
        } else {
            await sendText(order.customerPhone, "We're currently finding a delivery partner. We'll update you shortly.");
        }
    } else if (command === 'reject') {
        order.status = 'rejected_by_vendor';
        await saveOrUpdateOrder(order);
        await sendText(order.customerPhone, `❌ We're sorry, but *${order.vendor.name}* is unable to fulfill your order *${order.orderId}* at the moment. Please try ordering again later.`);
        delete sessions[order.customerPhone];
    }
}

async function handleDeliveryPartnerMessage(from, message) {
    const text = message.text?.body?.toLowerCase() || '';
    const [command, orderId] = text.split(' ');
    
    if (!orderId) return;

    const order = await getOrder(orderId.toUpperCase());
    if (!order) return;

    if (command === 'pickedup') {
        order.status = 'in_transit';
        await saveOrUpdateOrder(order);
        await sendProgressUpdate(order.customerPhone, 'pickedup');
    } else if (command === 'delivered') {
        order.status = 'delivered';
        await saveOrUpdateOrder(order);
        await sendProgressUpdate(order.customerPhone, 'delivered');
        
        // Ask for feedback
        await sendText(order.customerPhone, 'How was your experience? Please rate us from 1 (Poor) to 5 (Excellent)!');
        if (sessions[order.customerPhone]) {
            sessions[order.customerPhone].step = 'awaiting_feedback';
        }
    }
}


// ================== HELPER FUNCTIONS (API CALLS) ==================

async function sendMessage(data) {
    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data
        });
    } catch (error) {
        console.error('Error sending message:', error.response?.data || error.message);
    }
}

async function sendText(to, text) {
    await sendMessage({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } });
}

async function sendWelcomeMenu(to) {
    await sendMessage({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: 'Welcome to our Food Ordering service! How can we help you today?' },
            action: { buttons: [
                { type: 'reply', reply: { id: 'order_now', title: '🛍 Order Now' } },
                { type: 'reply', reply: { id: 'contact_us', title: '📞 Contact Us' } },
                { type: 'reply', reply: { id: 'help', title: '❓ Help' } }
            ]}
        }
    });
}

async function sendCatalogMenu(to) {
    await sendMessage({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
            type: 'product_list',
            header: { type: 'text', text: 'Our Delicious Menu' },
            body: { text: 'Tap below to see our menu and add items to your cart. 😋' },
            footer: { text: 'Powered by Whastapp' },
            action: {
                catalog_id: process.env.CATALOG_ID,
                sections: [ { title: 'Menu', product_items: [ /* You can feature up to 30 items here */ ] } ]
            }
        }
    });
}

async function requestUserLocation(to) {
    await sendMessage({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: 'To find the nearest restaurants, please share your current location.' },
            action: { buttons: [ { type: 'reply', reply: { id: 'location_button', title: '📍 Share Location' } } ] }
        }
    });
}

async function sendProgressUpdate(to, stage) {
    let timeline = '';
    if (stage === 'pickedup') {
        timeline = '✅ Order Confirmed\n✅ Food is being prepared\n✅ Picked up by Delivery Partner\n_... On the way!_\n\nYour order is on its way! Estimated delivery time is 15 minutes.';
    } else if (stage === 'delivered') {
        timeline = '✅ Order Confirmed\n✅ Food is being prepared\n✅ Picked up by Delivery Partner\n✅ Delivered!\n\nWe hope you enjoy your meal! 😊';
    }
    await sendText(to, timeline);
}

// Functions to message proxies
async function sendOrderToVendor(vendorPhone, order) {
    const items = order.cart.map(item => `${item.quantity} x ${item.product_retailer_id}`).join('\n');
    const message = `*New Order Alert: ${order.orderId}*\n\nItems:\n${items}\n\nTotal: ₹${order.total}\n\nReply with "accept ${order.orderId}" or "reject ${order.orderId}"`;
    await sendText(vendorPhone, message);
}

async function sendOrderToDeliveryPartner(dpPhone, order) {
    const message = `*New Delivery Task: ${order.orderId}*\n\nPickup from: *${order.vendor.name}*\nDeliver to: Near ${order.location.name || 'customer location'}\n\nReply "pickedup ${order.orderId}" once you collect the order.`;
    await sendText(dpPhone, message);
}

// ================== SERVER START ==================
connectDB().then(() => {
    seedDatabase();
    app.listen(port, () => {
        console.log(`✅ Server is running on port ${port}`);
    });
});