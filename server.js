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
