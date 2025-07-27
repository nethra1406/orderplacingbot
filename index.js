// index.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { connectDB, saveOrder } = require('./db'); // Import DB functions

// ================== EXPRESS SETUP ==================
const app = express();
const port = process.env.PORT || 10000;
app.use(bodyParser.json());

// In-memory session storage. For production, consider a persistent store like Redis.
const sessions = {};

// ================== WEBHOOK ==================

// To verify the webhook
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

// To process incoming messages
app.post('/webhook', async (req, res) => {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const session = sessions[from] || { step: 'greet', cart: [], userInfo: {} };
    const messageType = message.type;

    let userInput;
    if (messageType === 'text') {
        userInput = message.text.body.trim().toLowerCase();
    } else if (messageType === 'interactive') {
        userInput = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
    }

    try {
        switch (session.step) {
            case 'greet':
                if (["hi", "hello", "hey", "vanakkam"].includes(userInput)) {
                    await sendWelcomeAndButton(from);
                    session.step = 'wait_order_click';
                } else {
                    await sendText(from, '👋 Hello! Type "hi" to start ordering.');
                }
                break;

            case 'wait_order_click':
                if (userInput === 'order_now_btn') {
                    await sendCatalogLink(from);
                    session.step = 'ordering_catalog';
                } else {
                    await sendWelcomeAndButton(from); // Resend if they type something else
                }
                break;

            case 'ordering_catalog':
                if (messageType === 'order') {
                    session.cart = message.order.product_items;
                    session.step = 'get_name';
                    await sendText(from, '🛍 Your cart has been received! To proceed, please enter your name:');
                } else {
                    await sendText(from, 'Please add items from the catalog and submit your cart to continue.');
                }
                break;

            case 'get_name':
                session.userInfo.name = message.text.body;
                session.step = 'get_address';
                await sendText(from, `Thanks, ${session.userInfo.name}! Now, please enter your delivery address:`);
                break;

            case 'get_address':
                session.userInfo.address = message.text.body;
                session.step = 'get_payment';
                await sendPaymentOptions(from);
                break;

            case 'get_payment':
                if (['cash_btn', 'upi_btn', 'card_btn'].includes(userInput)) {
                    session.userInfo.payment = userInput.replace('_btn', '').toUpperCase();
                    session.step = 'confirm_order';
                    await sendOrderSummaryAndConfirm(from, session);
                } else {
                    await sendText(from, 'Please select a valid payment option from the buttons.');
                    await sendPaymentOptions(from); // Resend options
                }
                break;

            case 'confirm_order':
                if (userInput === 'place_order_btn') {
                    const orderId = `ORD-${Date.now()}`;
                    const total = session.cart.reduce((sum, item) => sum + (item.item_price * item.quantity), 0);

                    // Use the imported saveOrder function
                    await saveOrder({
                        orderId,
                        customerPhone: from,
                        cart: session.cart,
                        total,
                        userInfo: session.userInfo,
                        status: 'pending',
                        createdAt: new Date()
                    });

                    await sendText(from, `🎉 Your order ${orderId} has been placed! We’ll notify you once it’s processed.`);
                    delete sessions[from]; // End session
                } else if (userInput === 'cancel_order_btn') {
                    await sendText(from, 'Your order has been cancelled. Type "hi" to start a new order.');
                    delete sessions[from]; // End session
                } else {
                    await sendText(from, 'Please confirm or cancel your order using the buttons.');
                }
                break;

            default:
                await sendText(from, '🤖 Sorry, I didn\'t understand that. Type "hi" to start over.');
                delete sessions[from];
        }

        if (sessions[from]) {
            sessions[from] = session;
        }

    } catch (error) {
        console.error('Error processing webhook:', error.response?.data || error.message);
    }

    res.sendStatus(200);
});

// ================== HELPER FUNCTIONS ==================

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

async function sendWelcomeAndButton(to) {
    await sendMessage({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: '🧼 Welcome to Mochitochi Laundry! Click below to start your order.' },
            action: { buttons: [{ type: 'reply', reply: { id: 'order_now_btn', title: '🛍 Order Now' } }] }
        }
    });
}

async function sendCatalogLink(to) {
    await sendText(to, 'Redirecting you to our catalog... Please add items to your cart and hit submit. I\'ll be waiting for your order here!');
}

async function sendPaymentOptions(to) {
    await sendMessage({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: '💳 How would you like to pay?' },
            action: {
                buttons: [
                    { type: 'reply', reply: { id: 'cash_btn', title: 'Cash' } },
                    { type: 'reply', reply: { id: 'upi_btn', title: 'UPI' } },
                    { type: 'reply', reply: { id: 'card_btn', title: 'Card' } }
                ]
            }
        }
    });
}

async function sendOrderSummaryAndConfirm(to, session) {
    const { userInfo, cart } = session;
    const total = cart.reduce((sum, item) => sum + (item.item_price * item.quantity), 0);
    const itemsList = cart.map(item => `- ${item.quantity} x ${item.product_retailer_id} (@ ₹${item.item_price} each)`).join('\n');
    const summary = `*🧾 Order Summary*\n\n*Items:*\n${itemsList}\n\n*Total: ₹${total.toFixed(2)}*\n\n*Details:*\n👤 Name: ${userInfo.name}\n🏠 Address: ${userInfo.address}\n💳 Payment: ${userInfo.payment}\n\nPlease confirm your order.`;

    await sendMessage({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: summary },
            action: {
                buttons: [
                    { type: 'reply', reply: { id: 'place_order_btn', title: '✅ Place Order' } },
                    { type: 'reply', reply: { id: 'cancel_order_btn', title: '❌ Cancel' } }
                ]
            }
        }
    });
}

// ================== SERVER START ==================
// First, connect to the database, then start the server.
connectDB().then(() => {
    app.listen(port, () => {
        console.log(`✅ Server is running on port ${port}`);
    });
});