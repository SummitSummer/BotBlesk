require('dotenv').config();
const express = require('express');
const { bot, handlePaymentSuccess } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/webhook/platega', async (req, res) => {
  try {
    console.log('Platega webhook received:', req.body);
    console.log('Platega webhook headers:', req.headers);
    
    const merchantId = req.headers['x-merchantid'];
    const secret = req.headers['x-secret'];
    
    if (merchantId !== process.env.PLATEGA_SHOP_ID || secret !== process.env.PLATEGA_API_KEY) {
      console.error('Invalid webhook authentication');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { id, amount, currency, status, paymentMethod, payload } = req.body;
    
    if (status === 'CONFIRMED') {
      const orderId = payload;
      const userId = extractUserIdFromOrderId(orderId);
      
      if (userId) {
        await handlePaymentSuccess(orderId, userId);
      }
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/webhook/platega', (req, res) => {
  res.send('Webhook is alive!'); // Тестовый ответ
});
app.get('/success', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Успешная оплата</title>
        <meta charset="utf-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .success-icon {
            font-size: 60px;
            color: #4CAF50;
          }
          h1 {
            color: #333;
          }
          p {
            color: #666;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h1>Оплата успешна!</h1>
          <p>Вернитесь в Telegram-бот для завершения оформления заказа.</p>
        </div>
      </body>
    </html>
  `);
});

app.get('/fail', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Ошибка оплаты</title>
        <meta charset="utf-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .error-icon {
            font-size: 60px;
            color: #f44336;
          }
          h1 {
            color: #333;
          }
          p {
            color: #666;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error-icon">❌</div>
          <h1>Ошибка оплаты</h1>
          <p>Попробуйте еще раз или свяжитесь с поддержкой в боте.</p>
        </div>
      </body>
    </html>
  `);
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Blesk Bot</title>
        <meta charset="utf-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          h1 {
            color: #333;
          }
          p {
            color: #666;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎵 Blesk Spotify Bot</h1>
          <p>Бот работает!</p>
          <p>Перейдите в Telegram для начала работы.</p>
        </div>
      </body>
    </html>
  `);
});

function extractUserIdFromOrderId(orderId) {
  if (!orderId) return null;
  const match = orderId.match(/order_(\d+)_/);
  return match ? parseInt(match[1]) : null;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`✅ Bot is running`);
  console.log(`✅ Webhook endpoint: /webhook/platega`);
});
