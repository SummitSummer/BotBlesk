require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID = process.env.ADMIN_ID;

const userStates = new Map();
const orders = new Map();

const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '💳 Оплатить подписку', callback_data: 'buy_subscription' }],
      [{ text: '❓ FAQ', callback_data: 'faq' }],
      [{ text: '💬 Поддержка', callback_data: 'support' }]
    ]
  }
};

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const welcomeImage = path.join(__dirname, 'attached_assets', 'Pastel Purple Retro Bold Cafe Logo (7)_1759180055327.png');
  
  const welcomeText = `🎵 Добро пожаловать в Blesk - магазин подписок Spotify!\n\n` +
    `Здесь вы можете приобрести доступ к Spotify Family всего за 155 рублей в месяц.\n\n` +
    `Выберите действие:`;
  
  try {
    if (fs.existsSync(welcomeImage)) {
      await bot.sendPhoto(chatId, welcomeImage, {
        caption: welcomeText,
        ...mainKeyboard
      });
    } else {
      await bot.sendMessage(chatId, welcomeText, mainKeyboard);
    }
  } catch (error) {
    console.error('Error sending welcome message:', error);
    await bot.sendMessage(chatId, welcomeText, mainKeyboard);
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const userId = query.from.id;
  
  await bot.answerCallbackQuery(query.id);
  
  if (data === 'buy_subscription') {
    await handleBuySubscription(chatId, userId);
  } else if (data === 'faq') {
    await handleFAQ(chatId);
  } else if (data === 'support') {
    await handleSupport(chatId);
  } else if (data.startsWith('order_ready_')) {
    await handleOrderReady(data, query.from.id);
  }
});

async function handleBuySubscription(chatId, userId) {
  const message = `📦 Товар: Spotify Family (1 месяц)\n` +
    `💰 Цена: 155 рублей\n\n` +
    `Нажмите кнопку ниже для оплаты через СБП:`;
  
  try {
    const paymentUrl = await createPlategaPayment(userId);
    
    await bot.sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Оплатить 155₽', url: paymentUrl }],
          [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
      }
    });
  } catch (error) {
    console.error('Error creating payment:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при создании платежа. Попробуйте позже или свяжитесь с поддержкой.', mainKeyboard);
  }
}

async function createPlategaPayment(userId) {
  const { v4: uuidv4 } = require('uuid');
  const transactionId = uuidv4();
  const orderId = `order_${userId}_${Date.now()}`;
  
  const response = await axios.post('https://app.platega.io/transaction/process', {
    paymentMethod: 2,
    id: transactionId,
    paymentDetails: {
      amount: 155,
      currency: 'RUB'
    },
    description: 'Spotify Family подписка (1 месяц)',
    return: `https://${process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || 'example.com'}/success`,
    failedUrl: `https://${process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || 'example.com'}/fail`,
    payload: orderId
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-MerchantId': process.env.PLATEGA_SHOP_ID,
      'X-Secret': process.env.PLATEGA_API_KEY
    }
  });
  
  orders.set(orderId, { 
    userId, 
    transactionId,
    status: 'pending', 
    createdAt: Date.now() 
  });
  
  return response.data.redirect;
}

async function handleFAQ(chatId) {
  const faqText = `❓ Частые вопросы (FAQ)\n\n` +
    `📌 Что такое Spotify Family?\n` +
    `Это семейная подписка Spotify Premium, которая позволяет слушать музыку без рекламы, скачивать треки и наслаждаться высоким качеством звука.\n\n` +
    `📌 Как происходит активация?\n` +
    `После оплаты вы вводите логин и пароль от своего аккаунта Spotify, и наш администратор добавляет вас в семейную подписку.\n\n` +
    `📌 Сколько времени занимает активация?\n` +
    `Обычно от 5 минут до нескольких часов. Вы получите уведомление, когда подписка будет активирована.\n\n` +
    `📌 На какой срок выдается подписка?\n` +
    `Подписка выдается на 1 месяц (30 дней) с момента активации.\n\n` +
    `📌 Что делать, если возникли проблемы?\n` +
    `Свяжитесь с нашей поддержкой через кнопку "Поддержка" в главном меню.`;
  
  await bot.sendMessage(chatId, faqText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
      ]
    }
  });
}

async function handleSupport(chatId) {
  const supportText = `💬 Поддержка\n\n` +
    `Если у вас возникли вопросы или проблемы, напишите администратору:\n\n` +
    `👤 @admin_username`;
  
  await bot.sendMessage(chatId, supportText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Написать админу', url: `tg://user?id=${ADMIN_ID}` }],
        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
      ]
    }
  });
}

async function handlePaymentSuccess(orderId, userId) {
  userStates.set(userId, { state: 'waiting_login', orderId });
  
  await bot.sendMessage(userId, 
    `✅ Оплата успешно получена!\n\n` +
    `Теперь введите ваш логин от Spotify (email или имя пользователя):`
  );
}

async function handleOrderReady(callbackData, adminId) {
  if (adminId != ADMIN_ID) {
    await bot.sendMessage(adminId, '❌ У вас нет прав для выполнения этого действия.');
    return;
  }
  
  const orderId = callbackData.replace('order_ready_', '');
  const order = orders.get(orderId);
  
  if (!order) {
    await bot.sendMessage(adminId, '❌ Заказ не найден.');
    return;
  }
  
  await bot.sendMessage(order.userId, 
    `🟢 Ваша подписка Spotify Family активирована!\n\n` +
    `Можете пользоваться всеми преимуществами Premium на 30 дней.\n\n` +
    `Приятного прослушивания! 🎵`
  );
  
  await bot.sendMessage(adminId, `✅ Уведомление о готовности отправлено пользователю ${order.userId}`);
  
  order.status = 'completed';
  orders.set(orderId, order);
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  if (text && text.startsWith('/')) return;
  
  const userState = userStates.get(userId);
  
  if (userState && userState.state === 'waiting_login') {
    userStates.set(userId, { 
      ...userState, 
      state: 'waiting_password', 
      login: text 
    });
    
    await bot.sendMessage(chatId, `Теперь введите ваш пароль от Spotify:`);
  } else if (userState && userState.state === 'waiting_password') {
    const login = userState.login;
    const password = text;
    const orderId = userState.orderId;
    
    await bot.sendMessage(chatId, 
      `✅ Данные получены!\n\n` +
      `Ожидайте активации подписки. По готовности вам придет уведомление.`
    );
    
    const adminMessage = `🔔 Новый заказ #${orderId}\n\n` +
      `👤 Пользователь: ${userId}\n` +
      `📧 Логин Spotify: ${login}\n` +
      `🔑 Пароль Spotify: ${password}\n\n` +
      `После добавления пользователя в семейную подписку, нажмите кнопку "Готово":`;
    
    await bot.sendMessage(ADMIN_ID, adminMessage, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Готово', callback_data: `order_ready_${orderId}` }]
        ]
      }
    });
    
    orders.set(orderId, {
      ...orders.get(orderId),
      login,
      password,
      status: 'processing'
    });
    
    userStates.delete(userId);
  }
});

bot.on('callback_query', async (query) => {
  if (query.data === 'back_to_menu') {
    const chatId = query.message.chat.id;
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, 'Главное меню:', mainKeyboard);
  }
});

module.exports = { bot, handlePaymentSuccess };
