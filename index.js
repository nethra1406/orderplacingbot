// index.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { saveOrder } = require('./db');

const app = express();
const port = process.env.PORT || 10000;
app.use(bodyParser.json());

const sessions = {};
const userOrderStatus = {};

const verifiedNumbers = [
  '919916814517', '917358791933', '918072462490',
  '919444631398', '919043331484', '919710486191', '918838547515'
];

const catalogueItems = [
  { id: 'shirt_001', name: 'Shirts', price: 15 },
  { id: 'pants_001', name: 'Pants', price: 20 },
  { id: 'saree_001', name: 'Sarees', price: 100 },
  { id: 'suits_001', name: 'Suits', price: 250 },
  { id: 'bedsheets_001', name: 'Bed sheets', price: 60 },
  { id: 'winterwears_001', name: 'Winter wear', price: 150 },
  { id: 'curtains_001', name: 'Curtains', price: 120 },
  { id: 'stainremoval_001', name: 'Stain Removal', price: 50 }
];

// =================== Webhook Verification ===================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// =================== Webhook Receiver ===================
app.post('/webhook', async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return res.sendStatus(404);

  const from = message.from;
  const msg = message.text?.body?.trim().toLowerCase();

  if (!verifiedNumbers.includes(from)) {
    await sendText(from, '⚠️ Access restricted to verified users.');
    return res.sendStatus(200);
  }

  const session = sessions[from] || { step: 'greet', cart: [], userInfo: {} };

  switch (session.step) {
    case 'greet':
      if (['hi', 'hello', 'hey', 'vanakkam'].includes(msg)) {
        await sendCatalogMessage(from);
        session.step = 'ordering';
      } else {
        await sendText(from, '👋 Type "hi" to begin your order.');
      }
      break;

    case 'ordering':
      const selected = catalogueItems.find(i => msg.includes(i.name.toLowerCase()));
      if (selected) {
        session.cart.push({ ...selected, qty: 1 });
        await sendText(from, `✅ Added: ${selected.name} x 1.\nReply with another item or type "done" to proceed.`);
      } else if (msg === 'done') {
        if (!session.cart.length) {
          await sendText(from, '🛒 Your cart is empty. Please choose an item from our catalogue.');
        } else {
          session.step = 'get_name';
          await sendText(from, '👤 Please enter your name:');
        }
      } else {
        await sendText(from, '📦 Choose an item from our catalog (e.g., "Shirts", "Pants") or type "done".');
      }
      break;

    case 'get_name':
      session.userInfo.name = message.text.body.trim();
      session.step = 'get_address';
      await sendText(from, '📍 Please enter your address:');
      break;

    case 'get_address':
      session.userInfo.address = message.text.body.trim();
      session.step = 'get_payment';
      await sendText(from, '💳 Choose payment method: Cash / UPI / Card');
      break;

    case 'get_payment':
      session.userInfo.payment = message.text.body.trim();
      session.step = 'confirm_order';
      await sendOrderSummary(from, session);
      break;

    case 'confirm_order':
      if (msg === 'place order') {
        const orderId = `ORD-${Date.now()}`;
        await saveOrder({
          orderId,
          customerPhone: from,
          cart: session.cart,
          userInfo: session.userInfo,
          status: 'pending',
          createdAt: new Date()
        });
        userOrderStatus[from] = 'placed';
        await sendText(from, `🎉 Your order ${orderId} has been placed successfully!\nWe’ll update you once it’s picked up.`);
        delete sessions[from];
      } else {
        await sendText(from, '❓ Please type "Place Order" to confirm.');
      }
      break;

    default:
      await sendText(from, '🤖 Type "hi" to start placing your order.');
  }

  sessions[from] = session;
  res.sendStatus(200);
});

// =================== Utilities ===================
async function sendText(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

async function sendCatalogMessage(to) {
  const msg = '🧺 *Mochitochi Laundry Catalogue*\n\n' +
    catalogueItems.map(i => `• ${i.name} – ₹${i.price}`).join('\n') +
    '\n\nType an item name to add to your cart.\nType *done* to continue.';
  await sendText(to, msg);
}

async function sendOrderSummary(to, session) {
  const { cart, userInfo } = session;
  let total = 0;
  const summaryItems = cart.map(item => {
    const cost = item.qty * item.price;
    total += cost;
    return `• ${item.name} x ${item.qty} = ₹${cost}`;
  }).join('\n');

  const summary = `🧾 *Order Summary*\n${summaryItems}\n\n👤 ${userInfo.name}\n🏠 ${userInfo.address}\n💳 ${userInfo.payment}\n💰 Total: ₹${total}\n\n✅ Type *Place Order* to confirm.`;

  await sendText(to, summary);
}

// =================== Start Server ===================
app.listen(port, () => {
  console.log(`✅ Server is running at http://localhost:${port}`);
});
