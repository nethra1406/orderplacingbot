const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

// Load environment variables
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

const client = new MongoClient(MONGODB_URI || 'mongodb://localhost:27017');

async function sendMessage(to, message, buttons = null) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: message },
      action: {
        buttons: buttons || [
          { type: 'reply', reply: { id: 'order_now', title: '🛍 Order Now' } },
          { type: 'reply', reply: { id: 'contact_us', title: '📞 Contact Us' } },
          { type: 'reply', reply: { id: 'help', title: '❓ Help' } },
        ],
      },
    },
  };
  try {
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

async function sendCatalog(to) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, {
      messaging_product: 'whatsapp',
      to,
      type: 'catalog_message',
      catalog_id: CATALOG_ID, // Use the provided catalog ID
    });
  } catch (error) {
    console.error('Error sending catalog:', error);
  }
}

async function saveOrder(order) {
  try {
    await client.connect();
    const db = client.db(DB_NAME || 'laundryBot');
    const collection = db.collection('orders');
    await collection.insertOne(order);
  } catch (error) {
    console.error('Error saving order:', error);
  } finally {
    await client.close();
  }
}

async function handleMessage(event) {
  const from = event.from;
  let message = event.message?.text?.body?.toLowerCase() || event.message?.interactive?.button_reply?.id;
  let userData = {};
  let order = {};

  if (message === 'hi') {
    await sendMessage(from, 'Welcome to [Your Laundry Co.]! How can we assist you today?');
  } else if (message === 'order_now') {
    await sendCatalog(from);
    await sendMessage(from, 'Please select items from the catalog and place your order.');
    setTimeout(() => sendMessage(from, 'Please enter your name.', [{ type: 'reply', reply: { id: 'skip_name', title: 'Skip' } }]), 2000);
  } else if (message === 'skip_name' || userData.name) {
    userData.name = userData.name || 'User';
    await sendMessage(from, 'Please share your location or address.', [{ type: 'reply', reply: { id: 'default_loc', title: 'Use Default Location' } }]);
  } else if (message === 'default_loc' || userData.address) {
    userData.address = userData.address || 'Default Address';
    await sendMessage(from, 'Choose payment method:', [
      { type: 'reply', reply: { id: 'cash', title: 'Cash' } },
      { type: 'reply', reply: { id: 'upi', title: 'UPI' } },
      { type: 'reply', reply: { id: 'card', title: 'Card' } },
    ]);
  } else if (['cash', 'upi', 'card'].includes(message)) {
    userData.payment = message;
    order = {
      items: ['2 Shirts', '1 Comforter'],
      name: userData.name,
      address: userData.address,
      payment: userData.payment,
      total: 14,
      timestamp: new Date(),
    };
    await saveOrder(order);
    await sendMessage(from, `Order Summary: ${order.items.join(', ')}. Total: $${order.total}. Place Order?`, [
      { type: 'reply', reply: { id: 'place_order', title: 'Place Order' } },
    ]);
  } else if (message === 'place_order') {
    await sendMessage(from, 'Order placed! Awaiting vendor acceptance...');
    await sendMessage(VENDOR_PHONE_1, `New Order: ${order.items.join(', ')}. User: ${order.name}. Address: ${order.address}. Confirm?`);
    setTimeout(async () => {
      await sendMessage(from, 'Vendor accepted your order! Collection time: 10:00 PM IST.');
      await sendMessage(from, 'Vendor confirmation sent.');
      await sendMessage(VENDOR_PHONE_1, `User accepted. Proceed with collection.`);
      await sendMessage(DELIVERY_PARTNER_PHONE, `Pick up order from vendor. User: ${order.name}, Address: ${order.address}.`);
      setTimeout(async () => {
        await sendMessage(from, 'Delivery partner has collected your items. Progress: In Transit.');
        await sendMessage(from, 'Estimated delivery: 11:00 PM IST.');
        setTimeout(async () => {
          await sendMessage(from, 'Order delivered! Please rate us: [👍] [👎]');
          await sendMessage(DELIVERY_PARTNER_PHONE, 'Delivery completed. Collect feedback.');
        }, 5000);
      }, 5000);
    }, 5000);
  } else if (message.includes('👍') || message.includes('👎')) {
    await sendMessage(from, 'Thank you for your feedback!');
    await saveOrder({ ...order, feedback: message });
  }
}

// Webhook endpoints
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  if (req.body.object === 'whatsapp_business_account') {
    req.body.entry.forEach(entry => {
      entry.changes.forEach(change => {
        if (change.value.messages) {
          change.value.messages.forEach(message => handleMessage(message));
        }
      });
    });
  }
});

// Render compatibility: Use environment port or default to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));