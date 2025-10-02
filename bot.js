const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const geolib = require('geolib');
const levenshtein = require('fast-levenshtein');
const util = require('util');
const express = require('express'); // НОВОЕ: для веб-сервера
const app = express(); // НОВОЕ: для веб-сервера

// ================================================================= //
// --- НАСТРОЙКИ ---
// ================================================================= //
const TOKEN = process.env.TOKEN; // ВАЖНО: Используем переменную окружения!
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // ВАЖНО: Используем переменную окружения!
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+998123456789'; // Можно из ENV или по умолчанию
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || 'your_telegram_username'; // Можно из ENV или по умолчанию

const ADMIN_BTN_NEW = '🆕 Yangi buyurtmalar';
const ADMIN_BTN_ASSEMBLING = '🛠 Yig\'ilayotganlar';
const ADMIN_BTN_COMPLETED = '✅ Bajarilganlar';
const ADMIN_BTN_PRODUCTS = '📦 Mahsulotlar';
const ADMIN_BTN_ADD_PRODUCT = '➕ Yangi mahsulot qo\'shish';
const ADMIN_BTN_EDIT_PRODUCT = '✏️ Mahsulotni tahrirlash';
const ADMIN_BTN_DELETE_PRODUCT = '❌ Mahsulotni o\'chirish';
const ADMIN_BTN_BACK_TO_ADMIN_MENU = '⬅️ Admin panelga qaytish';
const ADMIN_BTN_BACK_TO_PRODUCTS_MENU = '⬅️ Mahsulotlar menyusiga qaytish';

const ORDERS_FILE_PATH = 'orders.json';
const PRODUCTS_FILE_PATH = 'products.json';

const MIN_ORDER_AMOUNT = 50000;
const DELIVERY_PRICE = 5000;
const FREE_DELIVERY_THRESHOLD = 100000;
const MAX_DELIVERY_RADIUS_KM = 2.5;

const SHOP_COORDINATES = { latitude: 40.764535, longitude: 72.282204 };
let db; // Будет загружено ниже

// ================================================================= //
// --- ИНИЦИАЛИЗАЦИЯ БОТА И ХРАНИЛИЩ ---
// ================================================================= //
try {
    db = JSON.parse(fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8'));
} catch (error) {
    console.error(`Ошибка при чтении ${PRODUCTS_FILE_PATH}:`, error);
    // Если файл пуст или некорректен, инициализируем пустую структуру
    db = { categories: [], products: [] };
    fs.writeFileSync(PRODUCTS_FILE_PATH, JSON.stringify(db, null, 2));
}

const bot = new TelegramBot(TOKEN, { polling: true });
const userCarts = {};
const userStates = {};

console.log('"One Mart" (FINAL v.2.2 - 24/7 Ready) ishga tushirildi...');

// ================================================================= //
// --- НОВОЕ: ЗАПУСК ПРОСТОГО ВЕБ-СЕРВЕРА ДЛЯ ПОДДЕРЖАНИЯ АКТИВНОСТИ ---
// ================================================================= //
const port = process.env.PORT || 3000; // Render предоставит свой PORT

app.get('/', (req, res) => {
  res.send('Bot is alive!'); // Простая страница для проверки активности
});

app.listen(port, () => {
  console.log(`Web server listening on port ${port} for uptime checks`);
});

// ================================================================= //
// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (без изменений от предыдущей версии) ---
// ================================================================= //
const readOrders = () => { if (!fs.existsSync(ORDERS_FILE_PATH)) return []; try { const fileContent = fs.readFileSync(ORDERS_FILE_PATH, 'utf8'); return fileContent ? JSON.parse(fileContent) : []; } catch (e) { console.error('Ошибка чтения orders.json:', e); return []; } };
const writeOrders = (orders) => { fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify(orders, null, 2)); };
const getStatusText = (status) => { const statuses = { new: 'Yangi', assembling: 'Yig\'ilmoqda', ready: 'Tayyor', delivering: 'Yetkazilmoqda', completed: 'Yetkazib berildi', cancelled: 'Bekor qilindi' }; return statuses[status] || status; };
const findProductById = (productId) => db.products.find(p => p.id === productId);

function saveDb() {
    fs.writeFileSync(PRODUCTS_FILE_PATH, JSON.stringify(db, null, 2));
    db = JSON.parse(fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8'));
}

function saveOrderToJson(chatId, cart, state) {
    const orders = readOrders();
    const lastOrder = orders.length > 0 ? orders[orders.length - 1] : null;
    const newOrderNumber = lastOrder && lastOrder.order_number ? lastOrder.order_number + 1 : 1001;
    const newOrderId = Date.now();
    const newOrder = { order_id: newOrderId, order_number: newOrderNumber, date: new Date().toISOString(), customer_chat_id: chatId, customer_phone: state.phone, cart: cart, delivery_cost: state.deliveryCost, total: state.total, location: state.location, status: 'new', comment: state.comment || null };
    orders.push(newOrder);
    writeOrders(orders);
    return { newOrderId, newOrderNumber };
}

function showCart(chatId, messageId) {
    const cart = userCarts[chatId];
    if (!cart || cart.length === 0) { const emptyText = 'Sizning savatingiz bo\'sh.'; if (messageId) { bot.editMessageText(emptyText, { chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard: []} }).catch(()=>{}); } else { bot.sendMessage(chatId, emptyText); } return; }
    let messageText = '🛒 Sizning savatingiz:\n\n'; let total = 0;
    const cartKeyboard = [];
    cart.forEach(item => { if (item.type === 'by_amount') { total += item.price; cartKeyboard.push([ { text: `▪️ ${item.name}`, callback_data: 'ignore' }, { text: '❌', callback_data: `cart_del_${item.id}` } ]); } else { const itemTotal = item.price * item.quantity; total += itemTotal; cartKeyboard.push([ { text: `▪️ ${item.name}`, callback_data: `ignore_${item.id}` }, { text: '➖', callback_data: `cart_decr_${item.id}` }, { text: `${item.quantity} dona`, callback_data: `ignore_${item.id}` }, { text: '➕', callback_data: `cart_incr_${item.id}` }, { text: '❌', callback_data: `cart_del_${item.id}` } ]); } });
    messageText += `\nJami: ${total.toLocaleString('uz-UZ')} so'm`;
    cartKeyboard.push( [{ text: "✍️ Izoh qoldirish", callback_data: 'leave_comment'}] );
    cartKeyboard.push( [{ text: "🧹 Savatni tozalash", callback_data: 'clear_cart' }], [{ text: "✅ Buyurtmani rasmiylashtirish", callback_data: 'checkout' }] );
    if (messageId) { bot.editMessageText(messageText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: cartKeyboard } }).catch(() => {}); }
    else { bot.sendMessage(chatId, messageText, { reply_markup: { inline_keyboard: cartKeyboard } }); }
}

function showCategories(chatId, messageId) { const categoryButtons = db.categories.map(category => ([{ text: category.name, callback_data: 'category_' + category.id }])); const text = 'Kategoriyani tanlang:'; if (messageId) { bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: categoryButtons } }).catch(() => {}); } else { bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: categoryButtons } }); } }

function showProductsByCategory(chatId, categoryId, messageId) {
    const productsInCategory = db.products.filter(p => p.category === categoryId);
    const backButton = [[{ text: '⬅️ Kategoriyalarga qaytish', callback_data: 'back_to_categories' }]];
    if (productsInCategory.length === 0) { const text = 'Bu kategoriyada hozircha mahsulotlar yo\'q.'; if (messageId) { bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: backButton } }).catch(()=>{}); } else { bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: backButton } }); } return; }
    const productButtons = productsInCategory.map(product => ([{ text: `${product.name} - ${product.price > 0 ? product.price.toLocaleString('uz-UZ') + ' so\'m' : (product.price_per_kg ? product.price_per_kg.toLocaleString('uz-UZ') + ' so\'m/kg' : 'Narxi so\'rov bo\'yicha')}`, callback_data: `product_${product.id}` }]));
    productButtons.push(backButton[0]);
    const text = 'Mahsulotni tanlang:';
    if (messageId) { bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: productButtons } }).catch(() => {}); } else { bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: productButtons } }); }
}

function getQuantityKeyboard(product, quantity) { return { inline_keyboard: [ [{ text: '➖', callback_data: `decrease_${product.id}_${quantity}` }, { text: `${quantity}`, callback_data: 'ignore' }, { text: '➕', callback_data: `increase_${product.id}_${quantity}` }], [{ text: `Savatga qo'shish (${(product.price * quantity).toLocaleString('uz-UZ')} so'm)`, callback_data: `addToCart_${product.id}_${quantity}` }], [{ text: '⬅️ Mahsulotlarga qaytish', callback_data: 'category_' + product.category }] ] }; }

function showQuantitySelector(chatId, product, quantity) {
    let caption = `${product.name}\nNarxi: ${product.price > 0 ? product.price.toLocaleString('uz-UZ') + ' so\'m' : (product.price_per_kg ? product.price_per_kg.toLocaleString('uz-UZ') + ' so\'m/kg' : '')}`;
    if (product.description) { caption += `\n\n_${product.description}_`; }
    const replyMarkup = getQuantityKeyboard(product, quantity);
    if (product.photo_url && product.photo_url.startsWith('http')) {
        bot.sendPhoto(chatId, product.photo_url, { caption: caption, parse_mode: 'Markdown', reply_markup: replyMarkup }).catch(() => {
            bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup });
        });
    } else {
        bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup });
    }
}

function updateQuantitySelector(chatId, messageId, product, quantity) { let caption = `${product.name}\nNarxi: ${product.price.toLocaleString('uz-UZ')} so'm`; if (product.description) { caption += `\n\n_${product.description}_`; } const replyMarkup = getQuantityKeyboard(product, quantity); bot.editMessageCaption(caption, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: replyMarkup }).catch(() => {}); }

function showOrdersByStatus(chatId, status, emptyMessage) { const orders = readOrders().filter(o => o.status === status).reverse(); if (orders.length === 0) { bot.sendMessage(chatId, emptyMessage); return; } const orderButtons = orders.map(order => { const orderDate = new Date(order.date).toLocaleString('ru-RU'); return [{ text: `Buyurtma #${order.order_number} (${orderDate})`, callback_data: `admin_view_order_${order.order_id}` }]; }); bot.sendMessage(chatId, `Statusdagi buyurtmalar "${getStatusText(status)}":`, { reply_markup: { inline_keyboard: orderButtons } }); }

function showAdminProductsMenu(chatId, messageId) {
    const text = 'Mahsulotlarni boshqarish:';
    const keyboard = {
        inline_keyboard: [
            [{ text: "➕ Yangi mahsulot qo'shish", callback_data: 'admin_add_product' }],
            [{ text: "✏️ Mahsulotni tahrirlash", callback_data: 'admin_edit_product' }],
            [{ text: "❌ Mahsulotni o'chirish", callback_data: 'admin_delete_product' }]
        ]
    };
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(()=>{});
    } else {
        bot.sendMessage(chatId, text, { reply_markup: keyboard });
    }
}

function handleStartCommand(msg) {
    const chatId = msg.chat.id; userCarts[chatId] = []; userStates[chatId] = {};
    if (chatId.toString() === ADMIN_CHAT_ID) { bot.sendMessage(chatId, 'Salom, Admin! Boshqaruv paneli:', { reply_markup: { keyboard: [[{ text: ADMIN_BTN_NEW }], [{ text: ADMIN_BTN_ASSEMBLING }, { text: ADMIN_BTN_COMPLETED }], [{ text: ADMIN_BTN_PRODUCTS }]], resize_keyboard: true } }); }
    else {
        const welcomeText = `Assalomu alaykum, "One Mart" do'koniga xush kelibsiz!\n\n` + `ℹ️ **Botdan foydalanish bo'yicha qo'llanma:**\n\n` + `1. **Katalog:** "🛍️ Mahsulotlar katalogi" tugmasi orqali mahsulotlarni ko'rib chiqing.\n` + `2. **Savat:** Mahsulotlarni savatga qo'shing va "🛒 Savat" tugmasi orqali tekshiring.\n` + `3. **Izoh:** Savatda "✍️ Izoh qoldirish" tugmasi orqali buyurtmangizga qo'shimcha ma'lumot yozishingiz mumkin.\n` + `4. **Status:** Buyurtma berganingizdan so'ng, uning holatini /status buyrug'i orqali tekshirishingiz mumkin.\n\n` + `🚚 **Yetkazib berish:** Buyurtmalar har kuni soat 19:00 gacha qabul qilinadi va 19:30 dan keyin yetkazib beriladi. 19:00 dan keyin qilingan buyurtmalar ertasi kuni yetkaziladi.`;
        bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown', reply_markup: { keyboard: [[{ text: "🛍️ Mahsulotlar katalogi" }, { text: "🛒 Savat" }], [{ text: "📞 Podderjka" }, { text: "🔄 Yangilash" }]], resize_keyboard: true } });
    }
}

bot.onText(/\/start/, handleStartCommand);
bot.onText(/🔄 Yangilash/, handleStartCommand);
bot.onText(/📞 Podderjka/, (msg) => { const supportText = `Qo'llab-quvvatlash xizmati:\n\n` + `Telefon: ${SUPPORT_PHONE}\n` + `Telegram: @${SUPPORT_USERNAME}`; bot.sendMessage(msg.chat.id, supportText); });
bot.onText(/\/admin/, (msg) => { if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return; bot.sendMessage(ADMIN_CHAT_ID, 'Admin Panel:', { reply_markup: { keyboard: [[{ text: ADMIN_BTN_NEW }], [{ text: ADMIN_BTN_ASSEMBLING }, { text: ADMIN_BTN_COMPLETED }], [{ text: ADMIN_BTN_PRODUCTS }]], resize_keyboard: true } }); });
bot.onText(/\/status/, (msg) => { const chatId = msg.chat.id; const orders = readOrders(); const lastActiveOrder = orders.filter(o => o.customer_chat_id === chatId && !['completed', 'cancelled'].includes(o.status)).pop(); if (lastActiveOrder) { const statusText = getStatusText(lastActiveOrder.status); const orderNumber = lastActiveOrder.order_number; const message = `Sizning #${orderNumber} raqamli buyurtmangiz holati: **${statusText}**`; bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }); } else { bot.sendMessage(chatId, 'Sizda hozir faol buyurtmalar yo\'q.'); } });
bot.onText(/🛍️ Mahsulotlar katalogi/, (msg) => { if (msg.chat.id.toString() === ADMIN_CHAT_ID) return; showCategories(msg.chat.id); });
bot.onText(/🛒 Savat|\/cart/, (msg) => { if (msg.chat.id.toString() === ADMIN_CHAT_ID) return; showCart(msg.chat.id); });
bot.onText(new RegExp(ADMIN_BTN_NEW), (msg) => { if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return; showOrdersByStatus(ADMIN_CHAT_ID, 'new', 'Yangi buyurtmalar yo\'q.'); });
bot.onText(new RegExp(ADMIN_BTN_ASSEMBLING), (msg) => { if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return; const orders = readOrders().filter(o => ['assembling', 'ready', 'delivering'].includes(o.status)); if (orders.length === 0) { bot.sendMessage(ADMIN_CHAT_ID, 'Yig\'ilayotgan buyurtmalar yo\'q.'); return; } const orderButtons = orders.map(order => { const orderDate = new Date(order.date).toLocaleTimeString('ru-RU'); return [{ text: `#${order.order_number} (${getStatusText(order.status)}) - ${orderDate}`, callback_data: `admin_view_order_${order.order_id}` }]; }); bot.sendMessage(ADMIN_CHAT_ID, `Faol buyurtmalar:`, { reply_markup: { inline_keyboard: orderButtons } }); });
bot.onText(new RegExp(ADMIN_BTN_COMPLETED), (msg) => { if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return; showOrdersByStatus(ADMIN_CHAT_ID, 'completed', 'Bajarilgan buyurtmalar yo\'q.'); });
bot.onText(new RegExp(ADMIN_BTN_PRODUCTS), (msg) => { if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return; showAdminProductsMenu(msg.chat.id); });

bot.on('contact', (msg) => { const chatId = msg.chat.id; userStates[chatId] = { ...userStates[chatId], phone: msg.contact.phone_number }; bot.sendMessage(chatId, 'Rahmat! Endi, iltimos, buyurtmani yetkazib berish manzilini yuboring.', { reply_markup: { keyboard: [[{ text: "📍 Manzilni yuborish", request_location: true }]], one_time_keyboard: true, resize_keyboard: true } }); });
bot.on('location', (msg) => { const chatId = msg.chat.id; const userLocation = msg.location; const distanceMeters = geolib.getDistance(SHOP_COORDINATES, userLocation); const distanceKm = distanceMeters / 1000; if (distanceKm > MAX_DELIVERY_RADIUS_KM) { bot.sendMessage(chatId, `Kechirasiz, biz ${MAX_DELIVERY_RADIUS_KM} km radiusdan tashqariga yetkazib bera olmaymiz. Sizning masofangiz: ${distanceKm.toFixed(2)} km.`, { reply_markup: { remove_keyboard: true } }); return; } const cart = userCarts[chatId]; if (!cart || cart.length === 0) { bot.sendMessage(chatId, "Savatingiz bo'sh, iltimos, qaytadan boshlang."); return; } const subtotal = cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0); const deliveryCost = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_PRICE; const total = subtotal + deliveryCost; userStates[chatId] = { ...userStates[chatId], location: userLocation, deliveryCost: deliveryCost, total: total }; let confirmationMessage = "Iltimos, buyurtmangizni tasdiqlang:\n\n"; cart.forEach(item => { confirmationMessage += `▪️ ${item.name} ${item.quantity ? `x ${item.quantity} dona` : ''} = ${(item.price * (item.quantity || 1)).toLocaleString('uz-UZ')} so'm\n`; }); const state = userStates[chatId]; if (state && state.comment) { confirmationMessage += `\nIzoh: ${state.comment}\n`; } confirmationMessage += `\nMahsulotlar: ${subtotal.toLocaleString('uz-UZ')} so'm\nYetkazib berish: ${deliveryCost > 0 ? deliveryCost.toLocaleString('uz-UZ') + ' so\'m' : 'Bepul'}\n\nJami: ${total.toLocaleString('uz-UZ')} so'm`; bot.sendMessage(chatId, confirmationMessage, { reply_markup: { inline_keyboard: [ [{ text: "✅ Tasdiqlash", callback_data: 'confirm_order' }], [{ text: "❌ Bekor qilish", callback_data: 'cancel_order' }] ] } }); });

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id; const messageId = query.message.message_id; const data = query.data;
    if (data.startsWith('admin_')) { const parts = data.split('_'); const action = parts[1]; const targetId = parseInt(parts.pop(), 10); if (action === 'view') { const order = readOrders().find(o => o.order_id === targetId); if (!order) { bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi!', show_alert: true }); return; } let details = `--- Buyurtma #${order.order_number} ---\n`; details += `Sana: ${new Date(order.date).toLocaleString('ru-RU')}\nMijoz raqami: ${order.customer_phone}\nHolat: ${getStatusText(order.status)}\n\n`; if (order.comment) { details += `Izoh: ${order.comment}\n\n`; } details += `Mahsulotlar:\n`; order.cart.forEach(item => { details += `- ${item.name} ${item.quantity ? `x ${item.quantity}` : ''}\n`; }); const { latitude, longitude } = order.location; details += `\nJami: ${order.total.toLocaleString('uz-UZ')} so'm\n📍 Manzil: https://www.google.com/maps?q=${latitude},${longitude}`; const statusButtons = []; if (order.status === 'new') { statusButtons.push({ text: '🛠 Yig\'ishni boshlash', callback_data: `admin_set_status_assembling_${order.order_id}` }); const now = new Date(); if (now.getHours() < 19) { statusButtons.push({ text: '❌ Bekor qilish', callback_data: `admin_set_status_cancelled_${order.order_id}` }); } } if (order.status === 'assembling') { statusButtons.push({ text: '✅ Tayyor', callback_data: `admin_set_status_ready_${order.order_id}` }); } if (order.status === 'ready') { statusButtons.push({ text: '🚚 Yetkazib berish', callback_data: `admin_set_status_delivering_${order.order_id}` }); } if (order.status === 'delivering') { statusButtons.push({ text: '🏁 Yetkazib berildi', callback_data: `admin_set_status_completed_${order.order_id}` }); } bot.sendMessage(chatId, details, { reply_markup: { inline_keyboard: [statusButtons] } }); } else if (action === 'set') { const newStatus = parts[2]; const allOrders = readOrders(); const orderIndex = allOrders.findIndex(o => o.order_id === targetId); if (orderIndex === -1) return; allOrders[orderIndex].status = newStatus; writeOrders(allOrders); const updatedOrder = allOrders[orderIndex]; bot.editMessageText(`Buyurtma #${updatedOrder.order_number} holati "${getStatusText(newStatus)}" ga o'zgartirildi.`, { chat_id: chatId, message_id: messageId }).catch(() => {}); const customerMessage = `Hurmatli mijoz, sizning #${updatedOrder.order_number} raqamli buyurtmangiz holati o'zgardi.\n\nYangi holat: **${getStatusText(newStatus)}**`; bot.sendMessage(updatedOrder.customer_chat_id, customerMessage, { parse_mode: 'Markdown' }); }
    // --- ОБРАБОТЧИКИ ДЛЯ АДМИН-МЕНЮ ПРОДУКТОВ ---
    else if (data === 'admin_add_product') {
        userStates[chatId] = { action: 'admin_add_product_step1' };
        bot.sendMessage(chatId, 'Yangi mahsulot nomini kiriting:');
    } else if (data === 'admin_edit_product') {
        userStates[chatId] = { action: 'admin_edit_product_select' };
        const productList = db.products.map(p => ([{ text: `${p.name} (ID: ${p.id})`, callback_data: `admin_select_product_to_edit_${p.id}` }]));
        productList.push([{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_products' }]);
        bot.editMessageText('Tahrirlash uchun mahsulotni tanlang:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: productList } });
    } else if (data.startsWith('admin_select_product_to_edit_')) {
        const productId = parseInt(data.split('_').pop(), 10);
        const product = findProductById(productId);
        if (!product) { bot.sendMessage(chatId, 'Mahsulot topilmadi.'); bot.answerCallbackQuery(query.id); return; }
        userStates[chatId] = { action: 'admin_edit_product_step1', productId: productId };
        const category = db.categories.find(c => c.id === product.category);
        let currentProductDetails = `*Mahsulotni tahrirlash:*\n\n` +
                                  `*Nomi:* ${product.name}\n` +
                                  `*Tasnifi:* ${product.description || 'Yo\'q'}\n` +
                                  `*Narxi:* ${product.price !== undefined ? product.price.toLocaleString('uz-UZ') + ' so\'m' : (product.price_per_kg ? product.price_per_kg.toLocaleString('uz-UZ') + ' so\'m/kg' : 'Narxi so\'rov bo\'yicha')}\n` +
                                  `*Kategoriya:* ${category ? category.name : 'Noma\'lum'}\n` +
                                  `*Rasm URL:* ${product.photo_url || 'Yo\'q'}\n` +
                                  `*Narxlash modeli:* ${product.pricing_model === 'by_amount' ? 'Summa bo\'yicha' : 'Dona bo\'yicha'}`;
        bot.editMessageText(currentProductDetails, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Nomini o\'zgartirish', callback_data: `admin_edit_field_${productId}_name` }],
                    [{ text: '✏️ Tasnifini o\'zgartirish', callback_data: `admin_edit_field_${productId}_description` }],
                    [{ text: '✏️ Narxini o\'zgartirish', callback_data: `admin_edit_field_${productId}_price` }],
                    [{ text: '✏️ Kategoriyasini o\'zgartirish', callback_data: `admin_edit_field_${productId}_category` }],
                    [{ text: '✏️ Rasm URL\'ini o\'zgartirish', callback_data: `admin_edit_field_${productId}_photo_url` }],
                    [{ text: '✏️ Narxlash modelini o\'zgartirish', callback_data: `admin_edit_field_${productId}_pricing_model` }],
                    [{ text: ADMIN_BTN_BACK_TO_PRODUCTS_MENU, callback_data: 'admin_products' }]
                ]
            }
        }).catch(()=>{});
    } else if (data.startsWith('admin_edit_field_')) {
        const parts = data.split('_');
        const productId = parseInt(parts[3], 10);
        const field = parts[4];
        userStates[chatId] = { action: `admin_awaiting_edit_value_${field}`, productId: productId, field: field };
        let prompt = '';
        if (field === 'name') prompt = 'Yangi mahsulot nomini kiriting:';
        else if (field === 'description') prompt = 'Yangi mahsulot tasnifini kiriting (Bo\'sh qoldirish uchun /skip):';
        else if (field === 'price') prompt = 'Yangi narxni kiriting (faqat raqamlar, masalan 15000):';
        else if (field === 'photo_url') prompt = 'Yangi rasm URL\'ini kiriting (Bo\'sh qoldirish uchun /skip):';
        else if (field === 'pricing_model') {
            bot.sendMessage(chatId, 'Narxlash modelini tanlang:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Dona bo\'yicha', callback_data: `admin_set_pricing_model_${productId}_standard` }],
                        [{ text: 'Summa bo\'yicha', callback_data: `admin_set_pricing_model_${productId}_by_amount` }]
                    ]
                }
            });
            bot.answerCallbackQuery(query.id); return;
        } else if (field === 'category') {
            const categoryList = db.categories.map(cat => ([{ text: cat.name, callback_data: `admin_set_category_${productId}_${cat.id}` }]));
            bot.sendMessage(chatId, 'Yangi kategoriyani tanlang:', { reply_markup: { inline_keyboard: categoryList } });
            bot.answerCallbackQuery(query.id); return;
        }
        bot.sendMessage(chatId, prompt);
    } else if (data.startsWith('admin_set_pricing_model_')) {
        const parts = data.split('_');
        const productId = parseInt(parts[4], 10);
        const model = parts[5];
        const productIndex = db.products.findIndex(p => p.id === productId);
        if (productIndex !== -1) {
            db.products[productIndex].pricing_model = model;
            saveDb();
            bot.editMessageText(`Mahsulot #${productId} narxlash modeli *${model === 'by_amount' ? 'Summa bo\'yicha' : 'Dona bo\'yicha'}* ga o'zgartirildi.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }).catch(()=>{});
        }
        delete userStates[chatId];
        showAdminProductsMenu(chatId, messageId);
    } else if (data.startsWith('admin_set_category_')) {
        const parts = data.split('_');
        const productId = parseInt(parts[3], 10);
        const categoryId = parts[4];
        const productIndex = db.products.findIndex(p => p.id === productId);
        if (productIndex !== -1) {
            db.products[productIndex].category = categoryId;
            saveDb();
            const category = db.categories.find(c => c.id === categoryId);
            bot.editMessageText(`Mahsulot #${productId} kategoriyasi *${category ? category.name : 'Noma\'lum'}* ga o'zgartirildi.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }).catch(()=>{});
        }
        delete userStates[chatId];
        showAdminProductsMenu(chatId, messageId);
    }
    else if (data === 'admin_delete_product') {
        userStates[chatId] = { action: 'admin_delete_product_select' };
        const productList = db.products.map(p => ([{ text: `${p.name} (ID: ${p.id})`, callback_data: `admin_confirm_delete_product_${p.id}` }]));
        productList.push([{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_products' }]);
        bot.editMessageText('O\'chirish uchun mahsulotni tanlang:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: productList } });
    } else if (data.startsWith('admin_confirm_delete_product_')) {
        const productId = parseInt(data.split('_').pop(), 10);
        const productIndex = db.products.findIndex(p => p.id === productId);
        if (productIndex !== -1) {
            const productName = db.products[productIndex].name;
            db.products.splice(productIndex, 1);
            saveDb();
            bot.editMessageText(`Mahsulot "${productName}" muvaffaqiyatli o'chirildi.`, { chat_id: chatId, message_id: messageId }).catch(()=>{});
        } else {
            bot.editMessageText('Mahsulot topilmadi.', { chat_id: chatId, message_id: messageId }).catch(()=>{});
        }
        delete userStates[chatId];
        showAdminProductsMenu(chatId, messageId);
    } else if (data === 'admin_back_to_admin_menu') {
        bot.deleteMessage(chatId, messageId).catch(()=>{});
        bot.sendMessage(chatId, 'Admin Panel:', { reply_markup: { keyboard: [[{ text: ADMIN_BTN_NEW }], [{ text: ADMIN_BTN_ASSEMBLING }, { text: ADMIN_BTN_COMPLETED }], [{ text: ADMIN_BTN_PRODUCTS }]], resize_keyboard: true } });
    } else if (data === 'admin_products') {
        showAdminProductsMenu(chatId, messageId);
    } else if (data.startsWith('admin_select_category_for_new_product_')) {
        const categoryId = data.split('_').pop();
        const state = userStates[chatId];
        if (state && state.action === 'admin_add_product_step4') {
            userStates[chatId] = { ...state, action: 'admin_add_product_step5', category: categoryId };
            bot.editMessageText('Kategoriya tanlandi. Endi mahsulot rasm URL\'ini kiriting (ixtiyoriy, bo\'sh qoldirish uchun /skip):', { chat_id: chatId, message_id: messageId }).catch(()=>{});
        }
    } else if (data.startsWith('admin_set_new_product_pricing_model_')) {
        const pricing_model = data.split('_').pop();
        const state = userStates[chatId];
        if (state && state.action === 'admin_add_product_step6') {
            const newProduct = {
                id: Date.now(), name: state.name, description: state.description, price: state.price,
                category: state.category, photo_url: state.photo_url, pricing_model: pricing_model
            };
            if (newProduct.price === 0) {
                newProduct.price_per_kg = 0; delete newProduct.price;
            }
            db.products.push(newProduct);
            saveDb();
            bot.editMessageText(`✅ Yangi mahsulot "${newProduct.name}" muvaffaqiyatli qo'shildi!`, { chat_id: chatId, message_id: messageId }).catch(()=>{});
            delete userStates[chatId];
            showAdminProductsMenu(chatId, messageId);
        }
    }
    bot.answerCallbackQuery(query.id); return;
    }
    if (data === 'back_to_categories') { showCategories(chatId, messageId); bot.answerCallbackQuery(query.id); return; }
    if (data.startsWith('category_')) { const categoryId = data.substring('category_'.length); if (query.message.photo) { await bot.deleteMessage(chatId, messageId).catch(() => {}); showProductsByCategory(chatId, categoryId); } else { showProductsByCategory(chatId, categoryId, messageId); } bot.answerCallbackQuery(query.id); return; }
    if (data.startsWith('product_')) { const productId = parseInt(data.split('_')[1], 10); const product = findProductById(productId); if (!product) { bot.answerCallbackQuery(query.id); return; } await bot.deleteMessage(chatId, messageId).catch(()=>{}); if (product.pricing_model === 'by_amount') { userStates[chatId] = { ...userStates[chatId], action: 'awaiting_product_amount', productId: productId }; const caption = `'${product.name}' uchun kerakli summani kiriting (masalan, 15000):\n\nBekor qilish uchun /cancel yozing.`; if (product.photo_url && product.photo_url.startsWith('http')) { bot.sendPhoto(chatId, product.photo_url, { caption: caption }); } else { bot.sendMessage(chatId, caption); } } else { showQuantitySelector(chatId, product, 1); } bot.answerCallbackQuery(query.id); return; }
    if (data.startsWith('increase_') || data.startsWith('decrease_')) { const parts = data.split('_'); const action = parts[0]; const productId = parseInt(parts[1], 10); let quantity = parseInt(parts[2], 10); const product = findProductById(productId); if (!product) { bot.answerCallbackQuery(query.id); return; } if (action === 'increase') { quantity++; } else if (action === 'decrease' && quantity > 1) { quantity--; } updateQuantitySelector(chatId, messageId, product, quantity); bot.answerCallbackQuery(query.id); return; }
    if (data.startsWith('addToCart_')) { const parts = data.split('_'); const productId = parseInt(parts[1], 10); const quantity = parseInt(parts[2], 10); const product = findProductById(productId); if (!product) { bot.answerCallbackQuery(query.id); return; } if (!userCarts[chatId]) { userCarts[chatId] = []; } const existingProductIndex = userCarts[chatId].findIndex(item => item.productId === productId); if (existingProductIndex > -1) { userCarts[chatId][existingProductIndex].quantity += quantity; } else { userCarts[chatId].push({ id: `${product.id}_${Date.now()}`, productId: product.id, name: product.name, quantity: quantity, price: product.price, type: 'standard' }); } bot.answerCallbackQuery(query.id, { text: `✅ ${product.name} (${quantity} dona) savatga qo'shildi!` }); await bot.deleteMessage(chatId, messageId).catch(() => {}); showCategories(chatId); return; }
    if (data === 'confirm_order') { const cart = userCarts[chatId]; const state = userStates[chatId]; if (!cart || !state || !state.phone || !state.location) { bot.answerCallbackQuery(query.id, { text: "Xatolik yuz berdi...", show_alert: true }); return; } const { newOrderId, newOrderNumber } = saveOrderToJson(chatId, cart, state); const orderTime = new Date(); let deliveryMessage; if (orderTime.getHours() >= 19) { deliveryMessage = "Sizning buyurtmangiz ertaga 19:30 dan keyin yetkazib beriladi."; } else { deliveryMessage = "Sizning buyurtmangiz bugun 19:30 dan keyin yetkazib beriladi."; } let adminMessage = `🔔 Yangi buyurtma! #${newOrderNumber}\n\n`; adminMessage += `Mijoz raqami: ${state.phone}\n\n`; if (state.comment) { adminMessage += `Izoh: ${state.comment}\n\n`; } cart.forEach(item => { adminMessage += `▪️ ${item.name} ${item.quantity ? `x ${item.quantity}` : ''}\n`; }); adminMessage += `\nJami: ${state.total.toLocaleString('uz-UZ')} so'm\n`; const { latitude, longitude } = state.location; adminMessage += `📍 Manzil: https://www.google.com/maps?q=${latitude},${longitude}`; bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { reply_markup: { inline_keyboard: [[{ text: `Buyurtmani ko'rish (#${newOrderNumber})`, callback_data: `admin_view_order_${newOrderId}` }]] } }); await bot.deleteMessage(chatId, messageId).catch(()=>{}); bot.sendMessage(chatId, `Rahmat! Sizning #${newOrderNumber} raqamli buyurtmangiz qabul qilindi.\n\n${deliveryMessage}\n\nHolatini /status buyrug'i orqali kuzatishingiz mumkin.`, { reply_markup: { keyboard: [[{ text: "🛍️ Mahsulotlar katalogi" }, { text: "🛒 Savat" }], [{ text: "📞 Podderjka" }, { text: "🔄 Yangilash" }]], resize_keyboard: true } }); userCarts[chatId] = []; delete userStates[chatId]; bot.answerCallbackQuery(query.id); return; }
    if (data === 'leave_comment') { userStates[chatId] = { ...userStates[chatId], action: 'awaiting_comment' }; bot.answerCallbackQuery(query.id); bot.sendMessage(chatId, 'Buyurtmangizga izoh yozing:'); return; }
    if (data.startsWith('cart_')) { const parts = data.split('_'); const action = parts[1]; const cartItemId = parts.slice(2).join('_'); const cart = userCarts[chatId]; if (!cart) { bot.answerCallbackQuery(query.id); return; } const productIndex = cart.findIndex(item => item.id.toString() === cartItemId.toString()); if (productIndex === -1) { bot.answerCallbackQuery(query.id); return; } const item = cart[productIndex]; if (item.type === 'standard') { if (action === 'incr') { item.quantity++; } else if (action === 'decr') { if (item.quantity > 1) { item.quantity--; } else { cart.splice(productIndex, 1); } } } if (action === 'del') { cart.splice(productIndex, 1); } showCart(chatId, messageId); bot.answerCallbackQuery(query.id); }
    else if (data === 'clear_cart') { userCarts[chatId] = []; showCart(chatId, messageId); bot.answerCallbackQuery(query.id, { text: 'Savat tozalandi!' }); }
    else if (data === 'checkout') { const cart = userCarts[chatId]; if (!cart || cart.length === 0) { bot.answerCallbackQuery(query.id, { text: 'Sizning savatingiz bo\'sh!', show_alert: true }); return; } const total = cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0); if (total < MIN_ORDER_AMOUNT) { bot.answerCallbackQuery(query.id, { text: `Minimal buyurtma miqdori ${MIN_ORDER_AMOUNT.toLocaleString('uz-UZ')} so'm.`, show_alert: true }); return; } bot.sendMessage(chatId, 'Yetkazib berish uchun telefon raqamingizni yuboring.', { reply_markup: { keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]], one_time_keyboard: true, resize_keyboard: true } }); bot.answerCallbackQuery(query.id); }
    else if (data === 'cancel_order') { userCarts[chatId] = []; delete userStates[chatId]; bot.editMessageText("Buyurtmangiz bekor qilindi.", { chat_id: chatId, message_id: messageId }); }
    else { bot.answerCallbackQuery(query.id); }
});

bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) { return; }
    const chatId = msg.chat.id;
    let state = userStates[chatId];

    if (chatId.toString() === ADMIN_CHAT_ID && state && state.action) {
        if (msg.text && msg.text.toLowerCase() === '/cancel') {
            bot.sendMessage(chatId, "Amal bekor qilindi.");
            delete userStates[chatId];
            showAdminProductsMenu(chatId);
            return;
        }

        if (state.action === 'admin_add_product_step1') {
            userStates[chatId] = { ...state, action: 'admin_add_product_step2', name: msg.text };
            bot.sendMessage(chatId, 'Mahsulot tasnifini kiriting (ixtiyoriy, bo\'sh qoldirish uchun /skip):');
        } else if (state.action === 'admin_add_product_step2') {
            const description = (msg.text && msg.text.toLowerCase() === '/skip') ? '' : msg.text;
            userStates[chatId] = { ...state, action: 'admin_add_product_step3', description: description };
            bot.sendMessage(chatId, 'Mahsulot narxini kiriting (faqat raqamlar, masalan 15000) yoki 0 agar narx kg/so\'rov bo\'yicha bo\'lsa:');
        } else if (state.action === 'admin_add_product_step3') {
            const price = parseInt(msg.text, 10);
            if (isNaN(price) || price < 0) {
                bot.sendMessage(chatId, 'Xatolik! Iltimos, faqat musbat raqam kiriting.');
                return;
            }
            userStates[chatId] = { ...state, action: 'admin_add_product_step4', price: price };
            const categoryButtons = db.categories.map(category => ([{ text: category.name, callback_data: `admin_select_category_for_new_product_${category.id}` }]));
            if (db.categories.length === 0) {
                bot.sendMessage(chatId, 'Kategoriyalar mavjud emas. Avval kategoriya qo\'shishingiz kerak.');
                delete userStates[chatId];
                showAdminProductsMenu(chatId);
                return;
            }
            bot.sendMessage(chatId, 'Mahsulot uchun kategoriyani tanlang:', { reply_markup: { inline_keyboard: categoryButtons } });
        } else if (state.action === 'admin_add_product_step5') {
            const photo_url = (msg.text && msg.text.toLowerCase() === '/skip') ? '' : msg.text;
            userStates[chatId] = { ...state, action: 'admin_add_product_step6', photo_url: photo_url };
            bot.sendMessage(chatId, 'Mahsulot narxlash modelini tanlang:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Dona bo\'yicha', callback_data: 'admin_set_new_product_pricing_model_standard' }],
                        [{ text: 'Summa bo\'yicha', callback_data: 'admin_set_new_product_pricing_model_by_amount' }]
                    ]
                }
            });
        } else if (state.action.startsWith('admin_awaiting_edit_value_')) {
            const field = state.field;
            const productId = state.productId;
            const productIndex = db.products.findIndex(p => p.id === productId);

            if (productIndex !== -1) {
                let value = msg.text;
                if (msg.text && msg.text.toLowerCase() === '/skip') {
                    value = '';
                }

                if (field === 'price') {
                    const newPrice = parseInt(value, 10);
                    if (isNaN(newPrice) || newPrice < 0) {
                        bot.sendMessage(chatId, 'Xatolik! Iltimos, faqat musbat raqam kiriting.');
                        return;
                    }
                    db.products[productIndex][field] = newPrice;
                } else {
                    db.products[productIndex][field] = value;
                }
                saveDb();
                bot.sendMessage(chatId, `Mahsulot #${productId} maydoni "${field}" muvaffaqiyatli yangilandi.`);
            } else {
                bot.sendMessage(chatId, 'Mahsulot topilmadi.');
            }
            delete userStates[chatId];
            showAdminProductsMenu(chatId);
        }
        return;
    }
    
    // --- ОБРАБОТЧИКИ ДЛЯ КЛИЕНТА ---
    if (!state || !state.action) return;

    if (state.action === 'awaiting_comment') {
        userStates[chatId] = { ...userStates[chatId], action: undefined, comment: msg.text };
        bot.sendMessage(chatId, `Izohingiz qabul qilindi: "${msg.text}"`);
        showCart(chatId);
        return;
    }

    if (state.action === 'awaiting_product_amount') {
        if (msg.text && msg.text.toLowerCase() === '/cancel') {
            delete userStates[chatId];
            bot.sendMessage(chatId, 'Amal bekor qilindi.');
            showCategories(chatId);
            return;
        }
        const amount = parseInt(msg.text, 10);
        if (isNaN(amount) || amount <= 0) {
            bot.sendMessage(chatId, 'Xatolik! Iltimos, to\'g\'ri summani kiriting (masalan, 15000).');
            return;
        }
        const productId = state.productId;
        const product = findProductById(productId);
        if (!product) {
            bot.sendMessage(chatId, 'Mahsulot topilmadi, iltimos qaytadan urining.');
            delete userStates[chatId];
            showCategories(chatId);
            return;
        }
        if (!userCarts[chatId]) {
            userCarts[chatId] = [];
        }
        userCarts[chatId].push({
            id: `${product.id}_${Date.now()}`, productId: product.id,
            name: `${product.name} (${amount.toLocaleString('uz-UZ')} so'm)`, quantity: 1, price: amount, type: 'by_amount'
        });
        bot.sendMessage(chatId, `✅ ${product.name} (${amount.toLocaleString('uz-UZ')} so'm) savatga qo'shildi!`);
        delete userStates[chatId];
        showCategories(chatId);
        return;
    }
});

bot.on('polling_error', (error) => {
    console.log(`Polling error: ${error.code} - ${error.message}`);
});