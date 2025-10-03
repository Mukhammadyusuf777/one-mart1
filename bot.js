const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const geolib = require('geolib');
const http = require("http");

// ================================================================= //
// --- НАСТРОЙКИ ---
// ================================================================= //
const TOKEN = process.env.TOKEN || '7976277994:AAFOmpAk4pdD85U9kvhmI-lLhtziCyfGTUY';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '5309814540';
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '-1002943886944'; // ID ГРУППЫ для уведомлений
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+998914906787';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || 'Mukhammadyusuf6787';

// --- Константы кнопок ---
const ADMIN_BTN_NEW = '🆕 Yangi buyurtmalar';
const ADMIN_BTN_ASSEMBLING = '🛠 Yig\'ilayotganlar';
const ADMIN_BTN_COMPLETED = '✅ Bajarilganlar';
const ADMIN_BTN_PRODUCTS = '📦 Mahsulotlar';
const ADMIN_BTN_CATEGORIES = '🗂 Kategoriyalar';
const ADMIN_BTN_ADD_PRODUCT = '➕ Yangi mahsulot qo\'shish';
const ADMIN_BTN_EDIT_PRODUCT = '✏️ Mahsulotni tahrirlash';
const ADMIN_BTN_DELETE_PRODUCT = '❌ Mahsulotni o\'chirish';
const ADMIN_BTN_ADD_CATEGORY = '➕ Yangi kategoriya qo\'shish';
const ADMIN_BTN_EDIT_CATEGORY = '✏️ Kategoriyani tahrirlash';
const ADMIN_BTN_DELETE_CATEGORY = '❌ Kategoriyani o\'chirish';
const ADMIN_BTN_BACK_TO_ADMIN_MENU = '⬅️ Admin panelga qaytish';
const ADMIN_BTN_BACK_TO_PRODUCTS_MENU = '⬅️ Mahsulotlar menyusiga qaytish';
const ADMIN_BTN_BACK_TO_CATEGORIES_MENU = '⬅️ Kategoriyalar menyusiga qaytish';

// --- Пути к файлам ---
const ORDERS_FILE_PATH = 'orders.json';
const PRODUCTS_FILE_PATH = 'products.json';

// --- Правила доставки ---
const DELIVERY_PRICE_TIER_1 = 8000;
const DELIVERY_PRICE_TIER_2 = 5000;
const DELIVERY_THRESHOLD_1 = 50000;
const DELIVERY_THRESHOLD_2 = 100000;
const BASE_DELIVERY_RADIUS_KM = 2.5;
const PRICE_PER_EXTRA_KM = 4000;
const MAX_DELIVERY_RADIUS_KM = 10;

// --- Координаты магазина ---
const SHOP_COORDINATES = { latitude: 40.764535, longitude: 72.282204 };

// ================================================================= //
// --- ИНИЦИАЛИЗАЦИЯ БОТА И ХРАНИЛИЩ ---
// ================================================================= //
const bot = new TelegramBot(TOKEN, { polling: true });

let db = { products: [], categories: [] };
try {
    if (fs.existsSync(PRODUCTS_FILE_PATH)) {
        const fileContent = fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8');
        if (fileContent) {
            db = JSON.parse(fileContent);
        }
        if (!db.products) db.products = [];
        if (!db.categories) db.categories = [];
    } else {
        fs.writeFileSync(PRODUCTS_FILE_PATH, JSON.stringify(db, null, 2), 'utf8');
    }
} catch (e) {
    console.error('CRITICAL ERROR: products.json faylini o\'qish yoki tahlil qilishda xatolik:', e);
    console.error('Iltimos, products.json faylining formati to\'g\'riligiga ishonch hosil qiling!');
}

const userCarts = {};
const userStates = {};

console.log('"One Mart" boti ishga tushirildi...');

// ... остальной код bot.js из предыдущего ответа ...
// (Так как он очень большой, я не буду его дублировать здесь снова,
// но вы можете взять его из самого последнего сообщения, где я его приводил)
