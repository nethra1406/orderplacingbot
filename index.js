// File: index.js
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

const sessions = {};
const userOrderStatus = {};
const vendors = ['919043331484'];
const verifiedNumbers = [
  '919916814517',
  '917358791933',
  '918072462490',
  '919444631398',
  '919043331484',
  '919710486191'
];

// ✅ Webhook Verification
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

// ✅ Webhook POST handler
app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(404);

    const from = message.from;
    const msgBody = message.text?.body?.trim();

    if (!verifiedNumbers.includes(from)) {
      await sendText(from, '⚠ Access restricted to verified users.');
      return res.sendStatus(200);
    }

    // ✅ Vendor accepts order
    const acceptMatch = msgBody.toLowerCase().match(/^accept\s+(ord-\d+|\d{3,})$/i);
    if (vendors.includes(from) && acceptMatch) {
      const code = acceptMatch[1].toUpperCase();
      const db = await connectDB();
      const ordersCollection = db.collection("orders");

      let order = null;

      if (code.startsWith("ORD-")) {
        order = await ordersCollection.findOne({ orderId: code });
      } else {
        const allPending = await ordersCollection.find({ status: "pending" }).sort({ createdAt: -1 }).toArray();
        order = allPending.find(o => o.orderId.endsWith(code));
      }

      if (!order) {
        await sendText(from, `❌ No order found matching "${code}".`);
        return res.sendStatus(200);
      }

      if (order.status === 'assigned') {
        await sendText(from, '🚫 This order is already assigned.');
        return res.sendStatus(200);
      }

      const orderId = order.orderId;

      await saveVendor(from);
      await assignVendorToOrder(orderId, from);
      await linkOrderToVendor(orderId, from);

      await sendText(from, `✅ You accepted order ${orderId}. Proceed with pickup.`);
      await sendText(order.customerPhone, `📦 Order ${orderId} is now being handled by 📞 ${from}.`);
      return res.sendStatus(200);
    }

    // ✅ Greetings handler
    const greetings = ['hi', 'hello', 'hey', 'vanakkam', 'hola', 'hai', 'namaste'];
    if (greetings.includes(msgBody.toLowerCase())) {
      await sendText(from, '👋 Hello! Let’s get started with your laundry order. Sending you the catalog...');
      sessions[from] = { step: 'catalog', cart: [], userInfo: {} };
      await sendCatalog(from);
      sessions[from].step = 'ordering';
      return res.sendStatus(200);
    }

    if (userOrderStatus[from] === 'placed' && msgBody.toLowerCase() === 'place order') {
      await sendText(from, '✅ Order already placed. Please wait.');
      return res.sendStatus(200);
    }

    const session = sessions[from] || { step: 'catalog', cart: [], userInfo: {} };

    switch (session.step) {
      case 'catalog':
        await sendCatalog(from);
        session.step = 'ordering';
        break;

      case 'ordering':
        if (msgBody.toLowerCase() === 'done') {
          if (!session.cart.length) {
            await sendText(from, '🛒 Cart is empty! Add something like "Shirt x 2" first.');
          } else {
            session.step = 'get_name';
            await sendText(from, '👤 Enter your full name:');
          }
        } else {
          const item = parseItem(msgBody);
          if (item) {
            session.cart.push(item);
            await sendText(from, `✅ Added: ${item.name} x ${item.qty}`);
            await sendText(from, '🛒 Add more or type "done"');
          } else {
            await sendText(from, '⚠ Use format like "Shirt x 2" to add items.');
          }
        }
        break;

      case 'get_name':
        if (msgBody.length < 2) {
          await sendText(from, '⚠ Name too short. Please enter your full name.');
        } else {
          session.userInfo.name = msgBody;
          session.step = 'get_address';
          await sendText(from, '📍 Enter delivery address:');
        }
        break;

      case 'get_address':
        if (msgBody.length < 5) {
          await sendText(from, '⚠ Please enter a valid delivery address.');
        } else {
          session.userInfo.address = msgBody;
          session.step = 'get_payment';
          await sendText(from, '💳 Payment method: Cash / UPI / Card');
        }
        break;

      case 'get_payment':
        const paymentType = msgBody.toLowerCase();
        if (!['cash', 'upi', 'card'].includes(paymentType)) {
          await sendText(from, '⚠ Invalid option. Choose Cash / UPI / Card');
        } else {
          session.userInfo.payment = msgBody;
          session.step = 'confirm_order';
          await sendOrderSummary(from, session);
        }
        break;

      case 'confirm_order':
        if (msgBody.toLowerCase() !== 'place order') {
          await sendText(from, '❓ To confirm your order, type "Place Order".');
        } else {
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
          setTimeout(() => delete userOrderStatus[from], 10 * 60 * 1000);

          await sendText(from, `🎉 Order ${orderId} placed! Finding vendor...`);
          for (const vendor of vendors) {
            await sendFullOrderToVendor(vendor, orderId, from, session);
          }

          delete sessions[from];
        }
        break;

      default:
        await sendText(from, `🤖 I'm not sure what that means. Please follow the steps or type "done" to continue.`);
        break;
    }

    sessions[from] = session;
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error:', err.message || err);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});

// =======================
// 🔧 Utility Functions
// =======================

async function sendText(to, text) {
  try {
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
    console.log(`✅ Message sent to ${to}: ${text}`);
  } catch (err) {
    console.error(`❌ Failed to send to ${to}:`, err.response?.data || err.message);
  }
}

async function sendCatalog(to) {
  const msg = `🧺 Mochitochi Laundry Menu:

👕 Shirt – ₹15  
👖 Pants – ₹20  
👗 Saree – ₹100  
🧥 Suit – ₹250

Reply like: "Shirt x 2"
Type "done" when finished.`;
  await sendText(to, msg);
}

function parseItem(input) {
  const match = input.match(/(.+?)\s*x\s*(\d+)/i);
  if (!match) return null;
  const name = match[1].trim();
  const qty = parseInt(match[2]);
  const prices = { shirt: 15, pants: 20, saree: 100, suit: 250 };
  const key = Object.keys(prices).find(k => name.toLowerCase().includes(k));
  const price = prices[key];
  return price ? { name, qty, price } : null;
}

async function sendOrderSummary(to, session) {
  const { cart, userInfo } = session;
  let total = 0;
  const items = cart.map(item => {
    const cost = item.qty * item.price;
    total += cost;
    return `• ${item.name} x ${item.qty} = ₹${cost}`;
  }).join('\n');

  const summary = `🧾 Order Summary:
${items}
————————————
👤 Name: ${userInfo.name}
🏠 Address: ${userInfo.address}
💳 Payment: ${userInfo.payment}
💰 Total: ₹${total}

✅ Type "Place Order" to confirm.`;

  await sendText(to, summary);
}

async function sendFullOrderToVendor(vendor, orderId, customerPhone, session) {
  const { userInfo, cart } = session;
  const items = cart.map(i => `- ${i.name} x ${i.qty} = ₹${i.qty * i.price}`).join('\n');
  const total = cart.reduce((sum, i) => sum + i.qty * i.price, 0);

  const fullMsg = `📢 New Order
🆔 Order ID: ${orderId}
📞 Customer: ${customerPhone}
👤 Name: ${userInfo.name}
🏠 Address: ${userInfo.address}
💳 Payment: ${userInfo.payment}

🧺 Items:
${items}
💰 Total: ₹${total}

Reply: ACCEPT ${orderId}`;

  await sendText(vendor, fullMsg);
}
