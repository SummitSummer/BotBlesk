require('dotenv').config();
const express = require('express');
const crypto = require('crypto');  // Для верификации подписи
const { bot, handlePaymentSuccess, orders } = require('./bot');  // Добавили orders

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/webhook/platega', async (req, res) => {
  try {
    console.log('Platega webhook received:', req.body);
    console.log('Platega webhook headers:', req.headers);
    
    // Верификация подписи (адаптируйте по реальным логам; предположим header 'x-signature' или в body)
    const receivedSig = req.headers['x-signature'] || req.body.signature;  // Или другой field из логов
    if (receivedSig) {
      const payloadString = JSON.stringify(req.body);  // Или конкатенация ключевых полей: req.body.id + '|' + req.body.status + '|' + req.body.payload
      const expectedSig = crypto.createHmac('sha256', process.env.PLATEGA_API_KEY)
        .update(payloadString)
        .digest('hex');
      if (receivedSig !== expectedSig) {
        console.error('Invalid signature');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    } else {
      console.warn('No signature provided — skipping verification (not recommended for production)');
    }
    
    const { id, amount, currency, status, paymentMethod, payload } = req.body;
    
    if (status === 'CONFIRMED' || status === 'success') {  // Добавили 'success' на случай другого значения; проверьте в логах
      const orderId = payload;
      const userId = extractUserIdFromOrderId(orderId);
      
      if (userId && orders.has(orderId)) {
        console.log('Processing confirmed payment for order:', orderId);
        await handlePaymentSuccess(orderId, userId);
        const order = orders.get(orderId);
        order.status = 'paid';  // Обновляем статус
        orders.set(orderId, order);
      } else {
        console.error('UserId or order not found for:', orderId);
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

// ... (остальные endpoints: /success, /fail, / — без изменений)

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
