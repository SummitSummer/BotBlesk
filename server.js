import express from 'express';
import crypto from 'crypto';
const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
// Статическая раздача файлов (изображения)
app.use('/static', express.static('./public'));

// Простой Telegram-бот для продаж подписок Spotify

// Валидация переменных окружения
function validateEnvironment() {
  const required = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    ADMIN_TELEGRAM_CHAT_ID: process.env.ADMIN_TELEGRAM_CHAT_ID,
    PLATEGA_API_KEY: process.env.PLATEGA_API_KEY,
    PLATEGA_MERCHANT_ID: process.env.PLATEGA_MERCHANT_ID
  };
  
  const missing = Object.entries(required)
    .filter(([key, value]) => !value)
    .map(([key]) => key);
  
  if (missing.length > 0) {
    console.error('❌ Отсутствуют переменные окружения:', missing.join(', '));
    process.exit(1);
  }
  
  console.log('✅ Все переменные окружения настроены');
  return required;
}

const ENV = validateEnvironment();
const TELEGRAM_BOT_TOKEN = ENV.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = ENV.ADMIN_TELEGRAM_CHAT_ID;
const PLATEGA_API_KEY = ENV.PLATEGA_API_KEY;
const PLATEGA_MERCHANT_ID = ENV.PLATEGA_MERCHANT_ID;

// Хранилище для пользовательских сессий (базовое файловое хранение)
import { readFileSync, writeFileSync, existsSync } from 'fs';

const SESSIONS_FILE = './user_sessions.json';

function loadSessions() {
  if (existsSync(SESSIONS_FILE)) {
    try {
      const data = readFileSync(SESSIONS_FILE, 'utf8');
      const sessions = new Map(JSON.parse(data));
      console.log('✅ Сессии загружены:', sessions.size, 'активных');
      return sessions;
    } catch (error) {
      console.warn('⚠️ Ошибка загрузки сессий, создаю новые');
    }
  }
  return new Map();
}

function saveSessions(sessions) {
  try {
    // БЕЗОПАСНОСТЬ: НЕ сохраняем пароли Spotify на диск
    // Сохраняем только состояние покупки без чувствительных данных
    const safeData = Array.from(sessions.entries()).map(([chatId, data]) => {
      const { spotifyPassword, ...safeSession } = data || {};
      return [chatId, safeSession];
    });
    const data = JSON.stringify(safeData);
    writeFileSync(SESSIONS_FILE, data);
  } catch (error) {
    console.error('❌ Ошибка сохранения сессий:', error);
  }
}

const userSessions = loadSessions();

// Отправка сообщения в Telegram
async function sendTelegramMessage(chatId, text, keyboard = null, isInlineKeyboard = false) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  
  if (keyboard) {
    if (isInlineKeyboard) {
      payload.reply_markup = {
        inline_keyboard: keyboard
      };
    } else {
      payload.reply_markup = {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: false
      };
    }
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      console.error('Ошибка отправки сообщения:', response.statusText);
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// Отправка изображения в Telegram
async function sendTelegramPhoto(chatId, photoPath, caption = null, keyboard = null) {
  try {
    const FormData = (await import('form-data')).default;
    const fs = await import('fs');
    const path = await import('path');
    
    console.log('🖼️ Попытка отправки фото:', { chatId, photoPath });
    
    // Проверяем существование файла
    if (!fs.existsSync(photoPath)) {
      console.error('❌ Файл не найден:', photoPath);
      return false;
    }
    
    console.log('📊 Файл найден, размер:', fs.statSync(photoPath).size, 'байт');
    
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', fs.createReadStream(photoPath));
    
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'Markdown');
    }
    
    if (keyboard) {
      form.append('reply_markup', JSON.stringify({
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: false
      }));
    }
    
    console.log('📤 Отправляю фото в Telegram API...');
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });
    
    const result = await response.json();
    if (!response.ok) {
      console.error('❌ Ошибка отправки фото:', {
        status: response.status,
        error: result.description || result.error_code,
        result: result
      });
      return false;
    } else {
      console.log('✅ Фото отправлено успешно!');
      return true;
    }
  } catch (error) {
    console.error('❌ Исключение при отправке фото:', error);
    return false;
  }
}

// Приветственное сообщение
async function sendWelcomeMessage(chatId) {
  // Используем абсолютный путь к файлу изображения
  const photoPath = './public/images/pikachu-spotify.png';
  await sendTelegramPhoto(chatId, photoPath);
  
  const welcomeText = `
🌟 *Добро пожаловать в Blesk!* 🌟

Ваш надёжный сервис подписок Spotify Family 🎵

💚 Премиум качество музыки
💰 Доступная цена — 155 руб/месяц  
⚡ Мгновенное подключение
🛡️ Гарантия безопасности

*Выберите действие:*
  `;
  
  const keyboard = [
    [{ text: "💳 Купить подписку (155 руб) ✅" }],
    [{ text: "🛠️ Саппорт" }, { text: "❓ FAQ" }]
  ];
  
  await sendTelegramMessage(chatId, welcomeText, keyboard);
}

// Создание платежа через Platega API
async function createPayment(chatId, amount = 155) {
  try {
    // Убеждаемся что chatId - строка
    const chatIdStr = String(chatId);
    const orderId = `blesk_${chatIdStr}_${Date.now()}`;
    
    // Генерируем UUID для транзакции
    const transactionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });

    const paymentData = {
      command: "CreateTransaction", // Обязательное поле для Platega API
      paymentMethod: 2, // СБП / QR
      id: transactionId, // UUID в правильном формате
      paymentDetails: {
        amount: amount,
        currency: "RUB"
      },
      description: `Подписка Spotify Family - Blesk`,
      return: `https://t.me/BleskBot`,
      failedUrl: `https://t.me/BleskBot`,
      payload: chatIdStr // сохраняем chatId для webhook
    };
    
    console.log('🔗 Отправляю запрос к Platega API:', {
      url: 'https://app.platega.io/transaction/process',
      headers: { 'X-MerchantId': PLATEGA_MERCHANT_ID, 'X-Secret': '[HIDDEN]' },
      body: paymentData
    });

    const response = await fetch('https://app.platega.io/transaction/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MerchantId': PLATEGA_MERCHANT_ID,
        'X-Secret': PLATEGA_API_KEY
      },
      body: JSON.stringify(paymentData)
    });
    
    console.log(`📡 Ответ от Platega API: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('❌ Ошибка API:', errorText);
      throw new Error(`Platega API error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    
    console.log('✅ Ответ от Platega:', result);
    
    // Platega возвращает ссылку на оплату в поле "redirect"
    if (result && result.redirect && result.status === 'PENDING') {
      return {
        success: true,
        paymentUrl: result.redirect,
        orderId: result.transactionId || transactionId,
        status: result.status,
        expiresIn: result.expiresIn
      };
    } else {
      console.log('❌ Неожиданный формат ответа:', result);
      throw new Error(`Invalid payment response from Platega: ${result?.status || 'unknown status'}`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка создания платежа:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Генерация ссылки на оплату
async function generatePaymentLink(chatId, amount = 155) {
  // Нормализуем chatId как строку
  const chatIdStr = String(chatId);
  const payment = await createPayment(chatIdStr, amount);
  
  if (!payment.success) {
    await sendTelegramMessage(chatIdStr, 
      '❌ Временная ошибка создания платежа.\n\n🛠️ Обратитесь в поддержку: @chanceofrain'
    );
    return;
  }
  
  const paymentText = `
💳 *Оплата подписки Spotify Family*

💰 Сумма: ${amount} руб/месяц
⏰ Действует: 30 дней

🔗 *Ссылка для оплаты:*
${payment.paymentUrl}

📝 *После успешной оплаты:*
1. Отправьте ваш логин Spotify
2. Отправьте ваш пароль Spotify
3. Ожидайте подключения (до 24 часов)

⚠️ *Важно:* Не должны состоять в семейном плане ранее!
  `;
  
  await sendTelegramMessage(chatIdStr, paymentText);
  
  // Устанавливаем состояние ожидания оплаты
  const session = {
    state: 'waiting_payment',
    paymentAmount: amount,
    orderId: payment.orderId,
    timestamp: Date.now()
  };
  
  userSessions.set(chatIdStr, session);
  saveSessions(userSessions);
}

// Обработка данных Spotify
async function collectSpotifyData(chatId, message) {
  // Нормализуем chatId как строку
  const chatIdStr = String(chatId);
  const session = userSessions.get(chatIdStr);
  
  if (!session) {
    await sendTelegramMessage(chatIdStr, "❌ Сессия не найдена. Начните заново с /start");
    return;
  }
  
  if (session.state === 'waiting_spotify_login') {
    // Сохраняем логин
    session.spotifyLogin = message;
    session.state = 'waiting_spotify_password';
    userSessions.set(chatIdStr, session);
    saveSessions(userSessions);
    
    await sendTelegramMessage(chatIdStr, 
      "✅ Логин сохранён!\n\n🔐 Теперь отправьте ваш *пароль* от Spotify:"
    );
    
  } else if (session.state === 'waiting_spotify_password') {
    // Сохраняем пароль
    session.spotifyPassword = message;
    session.state = 'completed';
    userSessions.set(chatIdStr, session);
    saveSessions(userSessions);
    
    // Уведомляем пользователя
    await sendTelegramMessage(chatIdStr, 
      "✅ *Данные получены!*\n\n📤 Ваша заявка отправлена администратору.\n⏰ Подключение в течение 24 часов.\n\n💚 Спасибо за выбор Blesk!"
    );
    
    // Уведомляем админа
    await notifyAdmin(session.spotifyLogin, session.spotifyPassword, chatIdStr, session.orderId);
    
    // НЕ очищаем сессию - оставляем для уведомления после активации
    session.state = 'waiting_activation';
    userSessions.set(chatIdStr, session);
    saveSessions(userSessions);
  }
}

// Уведомление админа
async function notifyAdmin(login, password, userChatId, orderId) {
  if (!ADMIN_CHAT_ID) {
    console.error('ADMIN_TELEGRAM_CHAT_ID не настроен');
    return;
  }
  
  const adminText = `
🔔 *Новая заявка на Spotify Family!*

👤 *Пользователь:* ${userChatId}
🔑 *Заказ:* \`${orderId}\`
📧 *Логин:* \`${login}\`
🔐 *Пароль:* \`${password}\`
💰 *Сумма:* 155 руб

⏰ *Время:* ${new Date().toLocaleString('ru-RU')}

*Обработайте заявку и подключите пользователя к семейному плану.*
  `;
  
  const keyboard = [
    [{ text: "✅ Готово", callback_data: `done_${userChatId}` }]
  ];
  
  await sendTelegramMessage(ADMIN_CHAT_ID, adminText, keyboard, true);
}

// FAQ
async function showFAQ(chatId) {
  const faqText = `
❓ *Частые вопросы (FAQ)*

*1. Проблема с подпиской?*
Обращайтесь в саппорт — восстановим + продлим на месяц ✅

*2. Как происходит подключение?*
После оплаты отправьте логин/пароль ✅

*3. Был в семейном плане за год?*
После оплаты обязательно сообщите в саппорт ✅

*4. Сколько стоит?*
155 руб/месяц за Spotify Family ✅

*5. Как долго ждать подключения?*
До 24 часов после отправки данных ✅
  `;
  
  await sendTelegramMessage(chatId, faqText);
}

// Webhook для уведомлений о платежах от Platega
app.post('/webhook/payment', async (req, res) => {
  try {
    const paymentData = req.body;
    
    // Ищем поля статуса и ID в данных от Platega
    const status = paymentData.status || paymentData.state || paymentData.payment_status;
    const transactionId = paymentData.id || paymentData.transactionId || paymentData.order_id;
    
    // Проверяем успешный статус
    const isSuccessful = status === 'paid' || status === 'success' || status === 'completed' || 
                        status === 'PAID' || status === 'SUCCESS' || status === 'CONFIRMED';
    
    if (isSuccessful && transactionId) {
      // Получаем chatId из payload который мы отправляли при создании платежа
      let chatIdStr = paymentData.payload;
      
      // Если payload нет, пробуем найти активные сессии ожидающие оплату
      if (!chatIdStr) {
        for (const [sessionChatId, session] of userSessions.entries()) {
          if (session.state === 'waiting_payment' && session.orderId === transactionId) {
            chatIdStr = sessionChatId;
            break;
          }
        }
      }
      
      // ВРЕМЕННО: для тестирования отправляем админу если chatId не найден
      if (!chatIdStr) {
        chatIdStr = ADMIN_CHAT_ID;
        await sendTelegramMessage(ADMIN_CHAT_ID, 
          `🔔 *Новый платеж получен!*\n\n💰 Сумма: 155 руб\n🔑 ID: \`${transactionId}\`\n📊 Статус: ${status}\n\n⚠️ ChatId не найден в данных платежа. Требуется ручная обработка.`
        );
      } else {
        // Обновляем сессию пользователя
        const session = userSessions.get(chatIdStr) || {};
        session.state = 'waiting_spotify_login';
        session.paymentConfirmed = true;
        session.transactionId = transactionId;
        session.timestamp = Date.now();
        
        userSessions.set(chatIdStr, session);
        saveSessions(userSessions);
        
        // Уведомляем пользователя
        await sendTelegramMessage(chatIdStr, 
          "✅ *Оплата успешно получена!*\n\n🎵 Теперь отправьте ваш *логин* от Spotify для подключения к семейному плану:\n\n💌 *Вы получите уведомление, когда ваш аккаунт будет готов к использованию!*"
        );
        
        // Уведомляем админа о новом платеже
        await sendTelegramMessage(ADMIN_CHAT_ID, 
          `💰 *Новый платеж обработан!*\n\n👤 Пользователь: ${chatIdStr}\n💳 ID: \`${transactionId}\`\n💰 Сумма: 155 руб\n\nПользователь переведен на этап ввода данных Spotify.`
        );
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Ошибка webhook:', error);
    res.status(500).send('Error');
  }
});

// Webhook для Telegram
app.post('/webhook/telegram', async (req, res) => {
  try {
    const update = req.body;
    
    // Обработка нажатия кнопок (callback_query)
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = String(callbackQuery.from.id);
      const data = callbackQuery.data;
      
      // Обработка кнопки "Готово" от админа
      if (data && data.startsWith('done_') && chatId === ADMIN_CHAT_ID) {
        const userChatId = data.replace('done_', '');
        
        // Уведомляем покупателя об активации подписки
        await sendTelegramMessage(userChatId, 
          "🎉 *Подписка активирована!*\n\n✅ Ваша подписка Spotify Family успешно подключена!\n🎵 Теперь вы можете пользоваться всеми возможностями семейного плана.\n\n💚 Спасибо за выбор Blesk!\n\n*Если возникнут вопросы - обращайтесь в саппорт.*"
        );
        
        // Отвечаем админу что операция выполнена
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: "✅ Покупатель уведомлен об активации!"
          })
        });
        
        // Очищаем сессию пользователя
        userSessions.delete(userChatId);
        saveSessions(userSessions);
      }
    }
    
    if (update.message) {
      const chatId = String(update.message.chat.id); // Нормализуем chatId как строку
      const text = update.message.text;
      const username = update.message.from.username || 'Пользователь';
      
      console.log(`📱 Получено сообщение от @${username}: ${text}`);
      
      // Обработка команд
      if (text === '/start') {
        await sendWelcomeMessage(chatId);
        
      } else if (text === '💳 Купить подписку (155 руб) ✅') {
        await generatePaymentLink(chatId);
        
      } else if (text === '🛠️ Саппорт') {
        await sendTelegramMessage(chatId, 
          "🛠️ *Поддержка Blesk*\n\n📞 Свяжитесь с нашим администратором:\n👤 @chanceofrain\n\n💚 Мы всегда готовы помочь!"
        );
        
      } else if (text === '❓ FAQ') {
        await showFAQ(chatId);
        
      } else {
        // Обработка данных Spotify
        const session = userSessions.get(chatId);
        if (session && (session.state === 'waiting_spotify_login' || session.state === 'waiting_spotify_password')) {
          await collectSpotifyData(chatId, text);
        } else if (session && session.state === 'waiting_payment') {
          // Пользователь ещё не оплатил
          await sendTelegramMessage(chatId, 
            "⏳ Пожалуйста, сначала завершите оплату по ссылке выше.\n\nПосле успешной оплаты отправьте данные Spotify."
          );
        } else {
          // Показываем меню если непонятная команда
          await sendTelegramMessage(chatId, 
            "❓ Используйте кнопки меню ниже:",
            [
              [{ text: "💳 Купить подписку (155 руб) ✅" }],
              [{ text: "🛠️ Саппорт" }, { text: "❓ FAQ" }]
            ]
          );
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка обработки webhook:', error);
    res.status(500).send('Error');
  }
});

// Стартовая страница
app.get('/', (req, res) => {
  res.send(`
    <h1>🌟 Blesk Bot - Spotify Family</h1>
    <p>✅ Бот запущен и готов к работе!</p>
    <p>💰 Продажи подписок Spotify Family за 155 руб/месяц</p>
    <p>📱 Telegram: @BleskBot</p>
  `);
});

// Настройка Telegram webhook
async function setupTelegramWebhook() {
  try {
    const domain = process.env.REPLIT_DOMAINS?.split(',')[0];
    if (!domain) {
      console.warn('⚠️ REPLIT_DOMAINS не найден, webhook не настроен');
      return;
    }
    
    const webhookUrl = `https://${domain}/webhook/telegram`;
    const setWebhookUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;
    
    console.log(`📡 Настраиваю Telegram webhook: ${webhookUrl}`);
    
    const response = await fetch(setWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ Telegram webhook настроен успешно!');
    } else {
      console.error('❌ Ошибка настройки webhook:', result.description);
    }
  } catch (error) {
    console.error('❌ Ошибка настройки Telegram webhook:', error.message);
  }
}

app.listen(port, '0.0.0.0', async () => {
  console.log(`🚀 Blesk Bot запущен на порту ${port}`);
  console.log(`💚 Готов к продажам подписок Spotify!`);
  
  // Настраиваем webhook автоматически
  await setupTelegramWebhook();
});
