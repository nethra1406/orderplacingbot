// index.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');

const app = express();
const port = process.env.PORT || 10000;
app.use(bodyParser.json());

const mongoClient = new MongoClient(process.env.MONGODB_URI);

const sessions = {};
const verifiedNumbers = [
  '919916814517', '917358791933', '918072462490',
  '919444631398', '919043331484', '919710486191', '918838547515'
];

const CATALOG_ID = '1189444639537872'; // ✅ Your actual catalog ID

// ============== MONGO ===================
async function saveOrder(order) {
  const db = mongoClient.db('whatsappBot');
  const collection = db.collection('orders');
  await collection.insertOne(order);
}

// ============== WEBHOOKS ===================
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
  if (!message) return res.sendStatus(404);

  const from = message.from;
  const msg = message.text?.body?.trim().toLowerCase();

  if (!verifiedNumbers.includes(from)) {
    await sendText(from, '⚠ Access restricted to verified users.');
    return res.sendStatus(200);
  }

  const session = sessions[from] || { step: 'greet', cart: [], userInfo: {} };

  switch (session.step) {
    case 'greet':
      if (['hi', 'hello', 'hey', 'vanakkam'].includes(msg)) {
        await sendCatalogView(from);
        session.step = 'ordering';
      } else {
        await sendText(from, '👋 Hello! Type "hi" to view our catalog and start ordering.');
      }
      break;

    case 'ordering':
      if (msg === 'done') {
        if (!session.cart.length) {
          await sendText(from, '🛒 Your cart is empty.');
        } else {
          session.step = 'get_name';
          await sendText(from, '👤 Please enter your name:');
        }
      } else {
        await sendText(from, '🛍 Tap items in the catalog and type "done" once finished.');
      }
      break;

    case 'get_name':
      session.userInfo.name = message.text.body;
      session.step = 'get_address';
      await sendText(from, '📍 Enter your address:');
      break;

    case 'get_address':
      session.userInfo.address = message.text.body;
      session.step = 'get_payment';
      await sendText(from, '💳 Payment method (Cash / UPI / Card):');
      break;

    case 'get_payment':
      session.userInfo.payment = message.text.body;
      session.step = 'confirm_order';
      await sendText(from, '🧾 Type "Place Order" to confirm your order.');
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
        await sendText(from, `🎉 Your order ${orderId} has been placed!`);
        delete sessions[from];
      } else {
        await sendText(from, '❓ Please type "Place Order" to confirm.');
      }
      break;

    default:
      await sendText(from, '🤖 Type "hi" to start ordering.');
  }

  sessions[from] = session;
  res.sendStatus(200);
});

// ============== FUNCTIONS ===================
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

async function sendCatalogView(to) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'product_list',
        header: { type: 'text', text: '🧺 Mochitochi Laundry Catalogue' },
        body: {
          text: 'Tap to view our top laundry services and pricing.'
        },
        footer: { text: '👇 Tap below to view and order!' },
        action: {
          catalog_id: CATALOG_ID,
          sections: [
            {
              title: 'Laundry Services',
              product_items: [] // WhatsApp auto-fills this from your catalog
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

// ============== START ===================
mongoClient.connect().then(() => {
  app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
  });
});
