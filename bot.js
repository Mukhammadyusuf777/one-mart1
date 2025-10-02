<<<<<<< HEAD
// Импортируем все необходимые модули
require('dotenv').config(); // Для загрузки переменных из .env файла
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const geolib = require('geolib');
const express = require('express');

// ================================================================= //
// --- НАСТРОЙКИ (загружаются из .env файла) ---
// ================================================================= //
const TOKEN = process.env.TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+998123456789';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || 'your_telegram_username';

// --- Константы для кнопок админ-панели ---
const ADMIN_BTN_NEW = '🆕 Yangi buyurtmalar';
const ADMIN_BTN_ASSEMBLING = '🛠 Yig\'ilayotganlar';
const ADMIN_BTN_COMPLETED = '✅ Bajarilganlar';
const ADMIN_BTN_PRODUCTS = '📦 Mahsulotlar';
const ADMIN_BTN_CATEGORIES = '🗂 Kategoriyalar';

// Product Management Buttons
const ADMIN_BTN_ADD_PRODUCT = '➕ Yangi mahsulot qo\'shish';
const ADMIN_BTN_EDIT_PRODUCT = '✏️ Mahsulotni tahrirlash';
const ADMIN_BTN_DELETE_PRODUCT = '❌ Mahsulotni o\'chirish';

// Category Management Buttons
const ADMIN_BTN_ADD_CATEGORY = '➕ Yangi kategoriya qo\'shish';
const ADMIN_BTN_EDIT_CATEGORY = '✏️ Kategoriyani tahrirlash';
const ADMIN_BTN_DELETE_CATEGORY = '❌ Kategoriyani o\'chirish';

// Navigation Buttons
const ADMIN_BTN_BACK_TO_ADMIN_MENU = '⬅️ Admin panelga qaytish';
const ADMIN_BTN_BACK_TO_PRODUCTS_MENU = '⬅️ Mahsulotlar menyusiga qaytish';
const ADMIN_BTN_BACK_TO_CATEGORIES_MENU = '⬅️ Kategoriyalar menyusiga qaytish';

// --- Пути к файлам данных ---
const ORDERS_FILE_PATH = 'orders.json';
const PRODUCTS_FILE_PATH = 'products.json';

// --- ПРАВИЛА ДОСТАВКИ ---
const DELIVERY_TIER_1 = 50000;      // Минимальная сумма заказа и первый порог цены
const DELIVERY_PRICE_1 = 8000;      // Цена доставки для заказов до 50,000 so'm
const DELIVERY_TIER_2 = 100000;     // Второй порог цены
const DELIVERY_PRICE_2 = 5000;      // Цена доставки для заказов от 50,000 до 100,000 so'm
const BASE_DELIVERY_RADIUS_KM = 2.5; // Базовый радиус, в пределах которого нет доплаты за км
const EXTRA_KM_PRICE = 4000;        // Цена за каждый дополнительный км сверх базового радиуса
const MAX_DELIVERY_RADIUS_KM = 10;  // Максимально допустимый радиус доставки

// --- Координаты магазина ---
const SHOP_COORDINATES = { latitude: 40.764535, longitude: 72.282204 };

// ================================================================= //
// --- ИНИЦИАЛИЗАЦИЯ ---
// ================================================================= //
let db;
const userCarts = {};
const userStates = {};

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express(); // Для веб-сервера

// --- Функция для проверки и создания файлов данных при запуске ---
function initializeDataFiles() {
    if (!fs.existsSync(PRODUCTS_FILE_PATH)) {
        console.warn(`"${PRODUCTS_FILE_PATH}" topilmadi. Avtomatik yaratiladi.`);
        // Создаем пустую структуру с одной категорией для примера
        db = {
            categories: [{ id: "cat1", name: "Meva va Sabzavotlar" }],
            products: []
        };
        saveDb();
    } else {
        try {
            const fileContent = fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8');
            db = JSON.parse(fileContent);
            if (!db.categories) db.categories = [];
            if (!db.products) db.products = [];
        } catch (e) {
            console.error(`Xatolik ${PRODUCTS_FILE_PATH} o'qishda:`, e);
            db = { categories: [], products: [] };
            saveDb();
        }
    }

    if (!fs.existsSync(ORDERS_FILE_PATH)) {
        console.warn(`"${ORDERS_FILE_PATH}" topilmadi. Avtomatik yaratiladi.`);
        fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify([], null, 2));
    }
}

// --- Запускаем веб-сервер для поддержки активности ---
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
});

initializeDataFiles();
console.log('"One Mart" (v.3.2 - Full Logic) ishga tushirildi...');


// ================================================================= //
// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
// ================================================================= //

const readOrders = () => { try { const data = fs.readFileSync(ORDERS_FILE_PATH, 'utf8'); return JSON.parse(data); } catch (e) { return []; } };
const writeOrders = (orders) => fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify(orders, null, 2));
const getStatusText = (status) => ({ new: 'Yangi', assembling: 'Yig\'ilmoqda', ready: 'Tayyor', delivering: 'Yetkazilmoqda', completed: 'Yetkazib berildi', cancelled: 'Bekor qilindi' }[status] || status);
const findProductById = (productId) => db.products.find(p => p.id === productId);
function saveDb() { fs.writeFileSync(PRODUCTS_FILE_PATH, JSON.stringify(db, null, 2)); }

function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

// --- Функция расчета стоимости доставки ---
function calculateDeliveryCost(subtotal, distanceKm) {
    let deliveryCost;

    if (subtotal >= DELIVERY_TIER_2) {
        deliveryCost = DELIVERY_PRICE_2; // От 100,000 сум
    } else if (subtotal >= DELIVERY_TIER_1) {
        deliveryCost = DELIVERY_PRICE_1; // От 50,000 до 100,000 сум
    } else {
        return DELIVERY_PRICE_1; // Заказы ниже 50,000 сум, хотя мы их и не пропускаем
    }

    // Добавляем доплату за расстояние
    if (distanceKm > BASE_DELIVERY_RADIUS_KM) {
        const extraDistance = distanceKm - BASE_DELIVERY_RADIUS_KM;
        const extraCharge = Math.ceil(extraDistance) * EXTRA_KM_PRICE; // Округляем км в большую сторону
        deliveryCost += extraCharge;
    }

    return deliveryCost;
}

// --- Сохранение заказа в JSON ---
function saveOrderToJson(chatId, cart, state) {
    const orders = readOrders();
    const lastOrder = orders.length > 0 ? orders[orders.length - 1] : null;
    const newOrderNumber = lastOrder && lastOrder.order_number ? lastOrder.order_number + 1 : 1001;
    const newOrderId = Date.now();
    const newOrder = {
        order_id: newOrderId,
        order_number: newOrderNumber,
        date: new Date().toISOString(),
        customer_chat_id: chatId,
        customer_phone: state.phone,
        cart: cart,
        delivery_cost: state.deliveryCost,
        total: state.total,
        location: state.location,
        status: 'new',
        comment: state.comment || null
    };
    orders.push(newOrder);
    writeOrders(orders);
    return { newOrderId, newOrderNumber };
}

// ================================================================= //
// --- ФУНКЦИИ ОТОБРАЖЕНИЯ (UI) ---
// ================================================================= //

function showCart(chatId, messageId) {
    const cart = userCarts[chatId];
    if (!cart || cart.length === 0) {
        const emptyText = 'Sizning savatingiz bo\'sh.';
        if (messageId) bot.editMessageText(emptyText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        else bot.sendMessage(chatId, emptyText);
        return;
    }

    let messageText = '🛒 Sizning savatingiz:\n\n';
    let subtotal = 0;

    cart.forEach(item => {
        const itemTotal = item.price * (item.quantity || 1);
        subtotal += itemTotal;

        let itemName = item.name;
        if(item.type === 'standard') {
            itemName = `${item.name} (${item.quantity} dona)`;
        }
        messageText += `▪️ ${itemName} = ${itemTotal.toLocaleString('uz-UZ')} so'm\n`;
    });

    messageText += `\nJami: ${subtotal.toLocaleString('uz-UZ')} so'm`;

    const itemButtons = cart.flatMap(item => {
        if (item.type === 'standard') {
            return [[
                { text: `➖ ${item.name.substring(0,10)}...`, callback_data: `cart_decr_${item.id}` },
                { text: '➕', callback_data: `cart_incr_${item.id}` },
                { text: '❌', callback_data: `cart_del_${item.id}` }
            ]];
        } else { // "by_amount"
            return [[{ text: `❌ O'chirish: ${item.name.substring(0,15)}...`, callback_data: `cart_del_${item.id}` }]];
        }
    });

    const actionButtons = [
        [{ text: "✍️ Izoh qoldirish", callback_data: 'leave_comment'}],
        [{ text: "🧹 Savatni tozalash", callback_data: 'clear_cart' }],
        [{ text: "✅ Buyurtmani rasmiylashtirish", callback_data: 'checkout' }]
    ];

    const finalKeyboard = [...itemButtons, ...actionButtons];

    if (messageId) {
        bot.editMessageText(messageText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: finalKeyboard } }).catch(() => {});
    } else {
        bot.sendMessage(chatId, messageText, { reply_markup: { inline_keyboard: finalKeyboard } });
    }
}

function showCategories(chatId, messageId) {
    const categoryButtons = db.categories.map(category => ([{ text: category.name, callback_data: 'category_' + category.id }]));
    const text = 'Kategoriyani tanlang:';
    const markup = { reply_markup: { inline_keyboard: categoryButtons } };

    if (messageId) bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...markup }).catch(() => {});
    else bot.sendMessage(chatId, text, markup);
}

function showProductsByCategory(chatId, categoryId, messageId) {
    const productsInCategory = db.products.filter(p => p.category === categoryId);
    const backButton = [[{ text: '⬅️ Kategoriyalarga qaytish', callback_data: 'back_to_categories' }]];

    if (productsInCategory.length === 0) {
        const text = 'Bu kategoriyada hozircha mahsulotlar yo\'q.';
        if (messageId) bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: backButton } }).catch(() => {});
        else bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: backButton } });
        return;
    }

    const productButtons = productsInCategory.map(product => ([{
        text: `${product.name} - ${product.price.toLocaleString('uz-UZ')} so'm`,
        callback_data: `product_${product.id}`
    }]));
    productButtons.push(...backButton);

    const text = 'Mahsulotni tanlang:';
    if (messageId) bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: productButtons } }).catch(() => {});
    else bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: productButtons } });
}

function getQuantityKeyboard(product, quantity) {
    const itemTotal = product.price * quantity;
    return {
        inline_keyboard: [
            [{ text: '➖', callback_data: `decrease_${product.id}_${quantity}` },
             { text: `${quantity}`, callback_data: 'ignore' },
             { text: '➕', callback_data: `increase_${product.id}_${quantity}` }],
            [{ text: `Savatga qo'shish (${itemTotal.toLocaleString('uz-UZ')} so'm)`, callback_data: `addToCart_${product.id}_${quantity}` }],
            [{ text: '⬅️ Mahsulotlarga qaytish', callback_data: `category_${product.category}` }]
        ]
    };
}

function showQuantitySelector(chatId, product, quantity = 1, messageId = null) {
    const caption = `${product.name}\nNarxi: ${product.price.toLocaleString('uz-UZ')} so'm\n\n_${product.description || ''}_`;
    const replyMarkup = getQuantityKeyboard(product, quantity);

    if(messageId) {
        bot.editMessageCaption(caption, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: replyMarkup }).catch(() => {});
        return;
    }

    if (product.photo_url && product.photo_url.startsWith('http')) {
        bot.sendPhoto(chatId, product.photo_url, { caption, parse_mode: 'Markdown', reply_markup: replyMarkup })
           .catch(() => bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup }));
    } else {
        bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup });
    }
}

// --- ADMIN UI FUNCTIONS ---
function showAdminMainMenu(chatId) {
    bot.sendMessage(chatId, 'Admin panel:', {
        reply_markup: {
            keyboard: [
                [{ text: ADMIN_BTN_NEW }],
                [{ text: ADMIN_BTN_ASSEMBLING }, { text: ADMIN_BTN_COMPLETED }],
                [{ text: ADMIN_BTN_PRODUCTS }, { text: ADMIN_BTN_CATEGORIES }]
            ],
            resize_keyboard: true
        }
    });
}

function showAdminProductsMenu(chatId, messageId) {
    const productListButtons = db.products.map(p => ([{
        text: `✏️ ${p.name}`,
        callback_data: `admin_edit_prod_${p.id}`
    }, {
        text: `❌ ${p.name}`,
        callback_data: `admin_delete_prod_${p.id}`
    }]));

    const keyboard = [
        [{ text: ADMIN_BTN_ADD_PRODUCT, callback_data: 'admin_add_product' }],
        ...productListButtons,
        [{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_back_to_main' }]
    ];

    const text = 'Mahsulotlarni boshqarish menyusi:';
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } }).catch(() => {});
    } else {
        bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    }
}

function showAdminCategoriesMenu(chatId, messageId) {
    const categoryListButtons = db.categories.map(c => ([{
        text: `✏️ ${c.name}`,
        callback_data: `admin_edit_cat_${c.id}`
    }, {
        text: `❌ ${c.name}`,
        callback_data: `admin_delete_cat_${c.id}`
    }]));

    const keyboard = [
        [{ text: ADMIN_BTN_ADD_CATEGORY, callback_data: 'admin_add_category' }],
        ...categoryListButtons,
        [{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_back_to_main' }]
    ];

    const text = 'Kategoriyalarni boshqarish menyusi:';
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } }).catch(() => {});
    } else {
        bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    }
}


// ================================================================= //
// --- КОМАНДЫ И ОБРАБОТЧИКИ ТЕКСТА ---
// ================================================================= //

function handleStartCommand(msg) {
    const chatId = msg.chat.id;
    userCarts[chatId] = [];
    userStates[chatId] = {};

    if (chatId.toString() === ADMIN_CHAT_ID) {
        showAdminMainMenu(chatId);
    } else {
        const welcomeText = `Assalomu alaykum, "One Mart" do'koniga xush kelibsiz!\n\n` +
            `🚚 *Yetkazib berish shartlari:*\n` +
            `   - Minimal buyurtma: *${DELIVERY_TIER_1.toLocaleString('uz-UZ')} so'm*\n` +
            `   - ${DELIVERY_TIER_1.toLocaleString('uz-UZ')} so'mdan ${DELIVERY_TIER_2.toLocaleString('uz-UZ')} so'mgacha: *${DELIVERY_PRICE_1.toLocaleString('uz-UZ')} so'm*\n` +
            `   - ${DELIVERY_TIER_2.toLocaleString('uz-UZ')} so'mdan yuqori: *${DELIVERY_PRICE_2.toLocaleString('uz-UZ')} so'm*\n` +
            `   - ${BASE_DELIVERY_RADIUS_KM} km dan uzoqqa har bir qo'shimcha km uchun +*${EXTRA_KM_PRICE.toLocaleString('uz-UZ')} so'm*.`;

        bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    [{ text: "🛍️ Mahsulotlar katalogi" }, { text: "🛒 Savat" }],
                    [{ text: "📞 Yordam" }, { text: "🔄 Yangilash" }]
                ],
                resize_keyboard: true
            }
        });
    }
}

bot.onText(/\/start/, handleStartCommand);
bot.onText(/🔄 Yangilash/, handleStartCommand);

bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    if (userStates[chatId] && userStates[chatId].action) {
        delete userStates[chatId];
        bot.sendMessage(chatId, "Amal bekor qilindi.", { reply_markup: { remove_keyboard: true } });
        // Если это админ, возвращаем его в главное меню
        if (chatId.toString() === ADMIN_CHAT_ID) {
            showAdminMainMenu(chatId);
        }
    }
});


bot.onText(/📞 Yordam/, (msg) => {
    bot.sendMessage(msg.chat.id, `Qo'llab-quvvatlash xizmati:\n\nTelefon: ${SUPPORT_PHONE}\nTelegram: @${SUPPORT_USERNAME}`);
});

bot.onText(/\/status/, (msg) => {
    const orders = readOrders();
    const lastOrder = orders.filter(o => o.customer_chat_id === msg.chat.id && !['completed', 'cancelled'].includes(o.status)).pop();
    if (lastOrder) {
        bot.sendMessage(msg.chat.id, `Sizning #${lastOrder.order_number} raqamli buyurtmangiz holati: *${getStatusText(lastOrder.status)}*`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, 'Sizda hozir faol buyurtmalar yo\'q.');
    }
});

// --- Обработчики обычных кнопок ---
bot.onText(/🛍️ Mahsulotlar katalogi/, (msg) => (msg.chat.id.toString() !== ADMIN_CHAT_ID) && showCategories(msg.chat.id));
bot.onText(/🛒 Savat/, (msg) => (msg.chat.id.toString() !== ADMIN_CHAT_ID) && showCart(msg.chat.id));

// --- Обработчики кнопок админа ---
bot.onText(new RegExp(ADMIN_BTN_NEW), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    const newOrders = readOrders().filter(o => o.status === 'new').reverse();
    if (newOrders.length === 0) return bot.sendMessage(ADMIN_CHAT_ID, 'Yangi buyurtmalar yo\'q.');
    bot.sendMessage(ADMIN_CHAT_ID, `Yangi buyurtmalar (${newOrders.length} dona):`);
    newOrders.forEach(order => {
        let adminMessage = `🔔 Buyurtma #${order.order_number}\n`;
        adminMessage += `📞 ${order.customer_phone}\n\n`;
        if (order.comment) adminMessage += `Izoh: ${order.comment}\n\n`;
        order.cart.forEach(item => adminMessage += `▪️ ${item.name} x ${item.quantity || 1} = ${(item.price * (item.quantity || 1)).toLocaleString('uz-UZ')} so'm\n`);
        adminMessage += `\nJami: *${order.total.toLocaleString('uz-UZ')} so'm*\n`;
        const { latitude, longitude } = order.location;
        adminMessage += `📍 [Manzilni xaritada ko'rish](https://maps.google.com/?q=${latitude},${longitude})`;

        bot.sendMessage(ADMIN_CHAT_ID, adminMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: `🛠 Yig'ishni boshlash`, callback_data: `admin_set_status_assembling_${order.order_id}` }]]
            }
        });
    });
});

bot.onText(new RegExp(ADMIN_BTN_ASSEMBLING), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    const assemblingOrders = readOrders().filter(o => ['assembling', 'ready', 'delivering'].includes(o.status));
    if (assemblingOrders.length === 0) return bot.sendMessage(ADMIN_CHAT_ID, 'Yig\'ilayotgan buyurtmalar yo\'q.');
    bot.sendMessage(ADMIN_CHAT_ID, `Yig'ilayotgan buyurtmalar (${assemblingOrders.length} dona):`);
    assemblingOrders.forEach(order => {
        let adminMessage = `🛠 Buyurtma #${order.order_number} (${getStatusText(order.status)})\n`;
        adminMessage += `📞 ${order.customer_phone}\n\n`;
        if (order.comment) adminMessage += `Izoh: ${order.comment}\n\n`;
        order.cart.forEach(item => adminMessage += `▪️ ${item.name} x ${item.quantity || 1} = ${(item.price * (item.quantity || 1)).toLocaleString('uz-UZ')} so'm\n`);
        adminMessage += `\nJami: *${order.total.toLocaleString('uz-UZ')} so'm*\n`;
        const { latitude, longitude } = order.location;
        adminMessage += `📍 [Manzilni xaritada ko'rish](https://maps.google.com/?q=${latitude},${longitude})`;

        const keyboard = [];
        if (order.status === 'assembling') {
            keyboard.push([{ text: `✅ Tayyor`, callback_data: `admin_set_status_ready_${order.order_id}` }]);
        } else if (order.status === 'ready') {
            keyboard.push([{ text: `🚀 Yetkazib berish`, callback_data: `admin_set_status_delivering_${order.order_id}` }]);
        } else if (order.status === 'delivering') {
            keyboard.push([{ text: `👍 Bajarildi`, callback_data: `admin_set_status_completed_${order.order_id}` }]);
        }
        keyboard.push([{ text: `❌ Bekor qilish`, callback_data: `admin_set_status_cancelled_${order.order_id}` }]);

        bot.sendMessage(ADMIN_CHAT_ID, adminMessage, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    });
});

bot.onText(new RegExp(ADMIN_BTN_COMPLETED), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    const completedOrders = readOrders().filter(o => o.status === 'completed');
    bot.sendMessage(ADMIN_CHAT_ID, `Jami ${completedOrders.length} ta buyurtma bajarilgan.`);
});

bot.onText(new RegExp(ADMIN_BTN_PRODUCTS), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    showAdminProductsMenu(msg.chat.id);
});

bot.onText(new RegExp(ADMIN_BTN_CATEGORIES), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    showAdminCategoriesMenu(msg.chat.id);
});


// ================================================================= //
// --- ОБРАБОТЧИКИ СОБЫТИЙ (КОНТАКТ, ЛОКАЦИЯ) ---
// ================================================================= //

bot.on('contact', (msg) => {
    const chatId = msg.chat.id;
    if (!userStates[chatId] || userStates[chatId].action !== 'awaiting_contact') return;

    userStates[chatId].phone = msg.contact.phone_number;
    userStates[chatId].action = 'awaiting_location';

    bot.sendMessage(chatId, 'Rahmat! Endi, iltimos, yetkazib berish manzilini yuboring.', {
        reply_markup: {
            keyboard: [[{ text: "📍 Manzilni yuborish", request_location: true }]],
            one_time_keyboard: true,
            resize_keyboard: true
        }
    });
});

bot.on('location', (msg) => {
    const chatId = msg.chat.id;
    if (!userStates[chatId] || userStates[chatId].action !== 'awaiting_location') return;

    const userLocation = msg.location;
    const distanceMeters = geolib.getDistance(SHOP_COORDINATES, userLocation);
    const distanceKm = distanceMeters / 1000;

    if (distanceKm > MAX_DELIVERY_RADIUS_KM) {
        bot.sendMessage(chatId, `Kechirasiz, biz ${MAX_DELIVERY_RADIUS_KM} km dan uzoqqa yetkazib bera olmaymiz. Sizning masofangiz: ${distanceKm.toFixed(1)} km.`, { reply_markup: { remove_keyboard: true } });
        delete userStates[chatId];
        return;
    }

    const cart = userCarts[chatId];
    const subtotal = cart.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
    const deliveryCost = calculateDeliveryCost(subtotal, distanceKm);
    const total = subtotal + deliveryCost;

    userStates[chatId] = { ...userStates[chatId], location: userLocation, deliveryCost, total, action: undefined };

    let confirmationMessage = "Iltimos, buyurtmangizni tasdiqlang:\n\n";
    cart.forEach(item => {
        confirmationMessage += `▪️ ${item.name} = ${(item.price * (item.quantity || 1)).toLocaleString('uz-UZ')} so'm\n`;
    });

    if (userStates[chatId].comment) {
        confirmationMessage += `\nIzoh: _${userStates[chatId].comment}_\n`;
    }

    confirmationMessage += `\nMahsulotlar: ${subtotal.toLocaleString('uz-UZ')} so'm\n`
    confirmationMessage += `Yetkazib berish: ${deliveryCost.toLocaleString('uz-UZ')} so'm\n`
    confirmationMessage += `\n*Jami: ${total.toLocaleString('uz-UZ')} so'm*`;

    bot.sendMessage(chatId, confirmationMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Tasdiqlash", callback_data: 'confirm_order' }],
                [{ text: "❌ Bekor qilish", callback_data: 'cancel_order' }]
            ]
        }
    });
});


// ================================================================= //
// --- ОСНОВНОЙ ОБРАБОТЧИК CALLBACK_QUERY ---
// ================================================================= //

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    bot.answerCallbackQuery(query.id).catch(() => {}); // Сразу отвечаем, чтобы кнопка не "висела"

    // --- Обработка админ-команд ---
    if (chatId.toString() === ADMIN_CHAT_ID) {
        if (data === 'admin_back_to_main') {
            showAdminMainMenu(chatId);
            bot.deleteMessage(chatId, messageId).catch(()=>{});
            delete userStates[chatId];
            return;
        } else if (data === 'admin_back_to_products_menu') {
            showAdminProductsMenu(chatId, messageId);
            delete userStates[chatId];
            return;
        } else if (data === 'admin_back_to_categories_menu') {
            showAdminCategoriesMenu(chatId, messageId);
            delete userStates[chatId];
            return;
        }

        if (data.startsWith('admin_set_status_')) {
            const parts = data.split('_');
            const newStatus = parts[3];
            const orderId = parseInt(parts.slice(4).join('_'), 10);

            const allOrders = readOrders();
            const orderIndex = allOrders.findIndex(o => o.order_id === orderId);

            if (orderIndex !== -1) {
                allOrders[orderIndex].status = newStatus;
                writeOrders(allOrders);
                const order = allOrders[orderIndex];

                bot.editMessageText(`Buyurtma #${order.order_number} holati "*${getStatusText(newStatus)}*" ga o'zgartirildi.`, {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
                }).catch(() => {});

                bot.sendMessage(order.customer_chat_id, `Sizning #${order.order_number} raqamli buyurtmangiz holati o'zgardi.\n\nYangi holat: *${getStatusText(newStatus)}*`, { parse_mode: 'Markdown' });
            }
            return;
        }

        // --- ADMIN: Product Management ---
        if (data === 'admin_add_product') {
            userStates[chatId] = { action: 'admin_add_product_name', product: {} };
            bot.sendMessage(chatId, 'Yangi mahsulot nomini kiriting:\n\nBekor qilish uchun /cancel yozing.');
            return;
        }
        if (data.startsWith('admin_edit_prod_')) {
            const productId = data.substring('admin_edit_prod_'.length);
            const productToEdit = db.products.find(p => p.id === productId);
            if (productToEdit) {
                userStates[chatId] = { action: 'admin_edit_product_select_field', product: productToEdit, originalMessageId: messageId };
                bot.sendMessage(chatId, `"${productToEdit.name}" mahsulotini tahrirlash.\nQaysi maydonni tahrirlaysiz?`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Nomi', callback_data: `admin_edit_prod_field_name_${productId}` }],
                            [{ text: 'Tasnifi', callback_data: `admin_edit_prod_field_desc_${productId}` }],
                            [{ text: 'Narxi', callback_data: `admin_edit_prod_field_price_${productId}` }],
                            [{ text: 'Rasmi URL', callback_data: `admin_edit_prod_field_photo_${productId}` }],
                            [{ text: 'Kategoriya', callback_data: `admin_edit_prod_field_category_${productId}` }],
                            [{ text: ADMIN_BTN_BACK_TO_PRODUCTS_MENU, callback_data: 'admin_back_to_products_menu' }]
                        ]
                    }
                });
            } else {
                bot.sendMessage(chatId, 'Mahsulot topilmadi.');
            }
            return;
        }
        if (data.startsWith('admin_edit_prod_field_')) {
            const parts = data.split('_');
            const field = parts[4];
            const productId = parts[5];
            const productToEdit = db.products.find(p => p.id === productId);
            if (productToEdit) {
                userStates[chatId] = { action: `admin_edit_product_input_${field}`, productId: productId, product: productToEdit, originalMessageId: messageId };
                if (field === 'category') {
                    const categoryButtons = db.categories.map(c => ([{ text: c.name, callback_data: `admin_update_prod_cat_${productId}_${c.id}` }]));
                    bot.sendMessage(chatId, `"${productToEdit.name}" uchun yangi kategoriyani tanlang:`, {
                        reply_markup: { inline_keyboard: categoryButtons }
                    });
                } else {
                    bot.sendMessage(chatId, `Mahsulot "${productToEdit.name}" uchun yangi ${field} kiriting.`);
                }
            }
            return;
        }
        if (data.startsWith('admin_delete_prod_')) {
            const productId = data.substring('admin_delete_prod_'.length);
            db.products = db.products.filter(p => p.id !== productId);
            saveDb();
            bot.editMessageText('Mahsulot o\'chirildi.', { chat_id: chatId, message_id: messageId }).catch(() => {});
            showAdminProductsMenu(chatId); // Refresh products list
            return;
        }


        // --- ADMIN: Category Management ---
        if (data === 'admin_add_category') {
            userStates[chatId] = { action: 'admin_add_category_name' };
            bot.sendMessage(chatId, 'Yangi kategoriya nomini kiriting:\n\nBekor qilish uchun /cancel yozing.');
            return;
        }
        if (data.startsWith('admin_edit_cat_')) {
            const categoryId = data.substring('admin_edit_cat_'.length);
            const categoryToEdit = db.categories.find(c => c.id === categoryId);
            if (categoryToEdit) {
                userStates[chatId] = { action: 'admin_edit_category_name', category: categoryToEdit, originalMessageId: messageId };
                bot.sendMessage(chatId, `"${categoryToEdit.name}" uchun yangi nom kiriting:`);
            } else {
                bot.sendMessage(chatId, 'Kategoriya topilmadi.');
            }
            return;
        }
        if (data.startsWith('admin_delete_cat_')) {
            const categoryId = data.substring('admin_delete_cat_'.length);
            db.categories = db.categories.filter(c => c.id !== categoryId);
            db.products = db.products.filter(p => p.category !== categoryId); // Remove products in deleted category
            saveDb();
            bot.editMessageText('Kategoriya va unga tegishli mahsulotlar o\'chirildi.', { chat_id: chatId, message_id: messageId }).catch(() => {});
            showAdminCategoriesMenu(chatId); // Refresh categories list
            return;
        }

        // --- ADMIN: Set Product Category during add/edit ---
        if (data.startsWith('admin_set_cat_')) {
            const categoryId = data.substring('admin_set_cat_'.length);
            let product = userStates[chatId].product;
            product.category = categoryId;
            product.id = generateUniqueId();
            db.products.push(product);
            saveDb();
            bot.sendMessage(chatId, `Mahsulot "${product.name}" muvaffaqiyatli qo'shildi!`);
            delete userStates[chatId];
            showAdminProductsMenu(chatId, messageId);
            return;
        }

        if (data.startsWith('admin_update_prod_cat_')) {
            const parts = data.split('_');
            const productId = parts[4];
            const categoryId = parts[5];
            const productIndex = db.products.findIndex(p => p.id === productId);
            if (productIndex !== -1) {
                db.products[productIndex].category = categoryId;
                saveDb();
                bot.sendMessage(chatId, "Mahsulot kategoriyasi o'zgartirildi!");
            }
            delete userStates[chatId];
            showAdminProductsMenu(chatId);
            return;
        }

        if (data.startsWith('admin_set_pricing_')) {
            const model = data.substring('admin_set_pricing_'.length); // 'standard' or 'by_amount'
            userStates[chatId].product.pricing_model = model;
            userStates[chatId].action = 'admin_add_product_category';

            const categoryButtons = db.categories.map(c => ([{ text: c.name, callback_data: 'admin_set_cat_' + c.id }]));
            if (categoryButtons.length === 0) {
                 bot.sendMessage(chatId, "Avval kategoriya qo'shing!");
                 delete userStates[chatId];
                 return;
            }
            bot.editMessageText('Endi mahsulot kategoriyasini tanlang:', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: categoryButtons }
            });
            return;
        }


        return; // Stop processing if it was an admin command
    }


    // --- Обработка клиентских команд ---
    switch (true) {
        case data === 'back_to_categories':
            if (query.message.photo) await bot.deleteMessage(chatId, messageId).catch(() => {});
            showCategories(chatId, query.message.photo ? null : messageId);
            break;

        case data.startsWith('category_'):
            const categoryId = data.substring('category_'.length);
            if (query.message.photo) await bot.deleteMessage(chatId, messageId).catch(() => {});
            showProductsByCategory(chatId, categoryId, query.message.photo ? null : messageId);
            break;

        case data.startsWith('product_'):
            const productId = data.split('_')[1];
            const product = findProductById(productId);
            if (product) {
                await bot.deleteMessage(chatId, messageId).catch(()=>{});

                if (product.pricing_model === 'by_amount') {
                    userStates[chatId] = { action: 'awaiting_product_amount', productId: productId };
                    bot.sendMessage(chatId, `'${product.name}' uchun kerakli summani kiriting (masalan, 15000).\n\nBekor qilish uchun /cancel yozing.`);
                } else { // standard
                    showQuantitySelector(chatId, product, 1);
                }
            }
            break;

        case data.startsWith('increase_') || data.startsWith('decrease_'):
            const partsQty = data.split('_');
            const productQty = findProductById(partsQty[1]);
            if (productQty) {
                let quantity = parseInt(partsQty[2], 10);
                if (partsQty[0] === 'increase') quantity++;
                else if (quantity > 1) quantity--;
                showQuantitySelector(chatId, productQty, quantity, messageId);
            }
            break;

        case data.startsWith('addToCart_'):
            const partsAdd = data.split('_');
            const productAdd = findProductById(partsAdd[1]);
            if (productAdd) {
                const quantityAdd = parseInt(partsAdd[2], 10);
                if (!userCarts[chatId]) userCarts[chatId] = [];

                const existingItemIndex = userCarts[chatId].findIndex(item => item.productId === productAdd.id && item.type === 'standard');
                if (existingItemIndex !== -1) {
                    userCarts[chatId][existingItemIndex].quantity += quantityAdd;
                } else {
                    userCarts[chatId].push({
                        id: `${productAdd.id}_${Date.now()}`,
                        productId: productAdd.id,
                        name: productAdd.name,
                        quantity: quantityAdd,
                        price: productAdd.price,
                        type: 'standard'
                    });
                }
                await bot.answerCallbackQuery(query.id, { text: `✅ ${productAdd.name} savatga qo'shildi!` });
                await bot.deleteMessage(chatId, messageId).catch(() => {});
                showCategories(chatId);
            }
            break;

        case data.startsWith('cart_'):
            const partsCart = data.split('_');
            const actionCart = partsCart[1];
            const itemId = partsCart.slice(2).join('_');
            const itemIndex = userCarts[chatId].findIndex(i => i.id === itemId);

            if (itemIndex !== -1) {
                 if (actionCart === 'del') {
                    userCarts[chatId].splice(itemIndex, 1);
                } else if (userCarts[chatId][itemIndex].type === 'standard') {
                    if (actionCart === 'incr') {
                        userCarts[chatId][itemIndex].quantity++;
                    } else if (actionCart === 'decr') {
                        if (userCarts[chatId][itemIndex].quantity > 1) {
                            userCarts[chatId][itemIndex].quantity--;
                        } else {
                             userCarts[chatId].splice(itemIndex, 1);
                        }
                    }
                }
                showCart(chatId, messageId);
            }
            break;

        case data === 'clear_cart':
            userCarts[chatId] = [];
            showCart(chatId, messageId);
            break;

        case data === 'leave_comment':
            userStates[chatId] = { ...userStates[chatId], action: 'awaiting_comment' };
            bot.sendMessage(chatId, 'Buyurtmangizga izoh yozing:\n\nBekor qilish uchun /cancel yozing.');
            break;

        case data === 'checkout':
            const cart = userCarts[chatId];
            if (!cart || cart.length === 0) {
                return;
            }
            const subtotal_checkout = cart.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
            if (subtotal_checkout < DELIVERY_TIER_1) {
                bot.answerCallbackQuery(query.id, { text: `Minimal buyurtma miqdori ${DELIVERY_TIER_1.toLocaleString('uz-UZ')} so'm.`, show_alert: true });
                return;
            }
            userStates[chatId] = { ...userStates[chatId], action: 'awaiting_contact' };
            bot.sendMessage(chatId, 'Yetkazib berish uchun telefon raqamingizni yuboring.', {
                reply_markup: {
                    keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]],
                    one_time_keyboard: true,
                    resize_keyboard: true
                }
            });
            break;

        case data === 'confirm_order':
            const finalState = userStates[chatId];
            const finalCart = userCarts[chatId];
            if (!finalCart || !finalState || !finalState.phone || !finalState.location) {
                bot.answerCallbackQuery(query.id, { text: "Xatolik yuz berdi.", show_alert: true });
                return;
            }
            const { newOrderId, newOrderNumber } = saveOrderToJson(chatId, finalCart, finalState);

            let adminMessage = `🔔 Yangi buyurtma! #${newOrderNumber}\n📞 ${finalState.phone}\n`;
            if (finalState.comment) adminMessage += `Izoh: ${finalState.comment}\n`;
            finalCart.forEach(item => adminMessage += `▪️ ${item.name} x ${item.quantity || 1} = ${(item.price * (item.quantity || 1)).toLocaleString('uz-UZ')} so'm\n`);
            adminMessage += `\nMahsulotlar: ${(finalState.total - finalState.deliveryCost).toLocaleString('uz-UZ')} so'm`;
            adminMessage += `\nYetkazib berish: ${finalState.deliveryCost.toLocaleString('uz-UZ')} so'm`;
            adminMessage += `\nJami: *${finalState.total.toLocaleString('uz-UZ')} so'm*\n`;
            const { latitude, longitude } = finalState.location;
            adminMessage += `📍 [Manzil](https://maps.google.com/?q=${latitude},${longitude})`;

            bot.sendMessage(ADMIN_CHAT_ID, adminMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: `🛠 Yig'ishni boshlash`, callback_data: `admin_set_status_assembling_${newOrderId}` }]]
                }
            });

            await bot.editMessageText(`Rahmat! Sizning #${newOrderNumber} raqamli buyurtmangiz qabul qilindi.\n\nHolatini /status buyrug'i orqali kuzatishingiz mumkin.`, {
                chat_id: chatId, message_id: messageId
            });

            userCarts[chatId] = [];
            delete userStates[chatId];
            break;

        case data === 'cancel_order':
            delete userStates[chatId].location;
            delete userStates[chatId].total;
            delete userStates[chatId].deliveryCost;
            bot.editMessageText("Buyurtma bekor qilindi.", { chat_id: chatId, message_id: messageId });
            showCart(chatId);
            break;
    }
});

// ================================================================= //
// --- ОБРАБОТЧИК СООБЩЕНИЙ ДЛЯ МНОГОШАГОВЫХ ДЕЙСТВИЙ ---
// ================================================================= //

bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const state = userStates[chatId];

    if (!state || !state.action) return;

    // --- Логика для Админа ---
    if (chatId.toString() === ADMIN_CHAT_ID) {
        let product = state.product || {};
        let category = state.category || {};

        switch(state.action) {
            // --- Product Add Flow ---
            case 'admin_add_product_name':
                product.name = msg.text;
                userStates[chatId] = { action: 'admin_add_product_desc', product };
                bot.sendMessage(chatId, 'Endi mahsulot tasnifini (opisanie) kiriting:');
                break;
            case 'admin_add_product_desc':
                product.description = msg.text;
                userStates[chatId] = { action: 'admin_add_product_price', product };
                bot.sendMessage(chatId, 'Endi mahsulot narxini kiriting (faqat raqam):');
                break;
            case 'admin_add_product_price':
                const price = parseInt(msg.text, 10);
                if (isNaN(price) || price <= 0) {
                    bot.sendMessage(chatId, 'Narx raqamda va musbat bo\'lishi kerak. Qaytadan urinib ko\'ring.');
                    return;
                }
                product.price = price;
                userStates[chatId] = { action: 'admin_add_product_photo', product };
                bot.sendMessage(chatId, 'Endi mahsulot rasmining URL manzilini kiriting yoki "Yo\'q" deb yozing, agar rasm bo\'lmasa:');
                break;
            case 'admin_add_product_photo':
                product.photo_url = (msg.text.toLowerCase() === 'yo\'q' || msg.text.toLowerCase() === 'yok') ? null : msg.text;
                userStates[chatId] = { action: 'admin_add_product_pricing_model', product };
                bot.sendMessage(chatId, 'Mahsulot qanday narxlanadi?', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Miqdor bo\'yicha (dona)', callback_data: 'admin_set_pricing_standard' }],
                            [{ text: 'Summa bo\'yicha (so\'m)', callback_data: 'admin_set_pricing_by_amount' }]
                        ]
                    }
                });
                break;

            // --- Product Edit Flow ---
            case 'admin_edit_product_input_name':
                state.product.name = msg.text;
                saveDb();
                bot.sendMessage(chatId, 'Mahsulot nomi tahrirlandi!');
                showAdminProductsMenu(chatId, state.originalMessageId);
                delete userStates[chatId];
                break;
            case 'admin_edit_product_input_desc':
                state.product.description = msg.text;
                saveDb();
                bot.sendMessage(chatId, 'Mahsulot tasnifi tahrirlandi!');
                showAdminProductsMenu(chatId, state.originalMessageId);
                delete userStates[chatId];
                break;
            case 'admin_edit_product_input_price':
                const editedPrice = parseInt(msg.text, 10);
                if (isNaN(editedPrice) || editedPrice <= 0) {
                    bot.sendMessage(chatId, 'Narx raqamda va musbat bo\'lishi kerak. Qaytadan urinib ko\'ring.');
                } else {
                    state.product.price = editedPrice;
                    saveDb();
                    bot.sendMessage(chatId, 'Mahsulot narxi tahrirlandi!');
                    showAdminProductsMenu(chatId, state.originalMessageId);
                    delete userStates[chatId];
                }
                break;
            case 'admin_edit_product_input_photo':
                state.product.photo_url = (msg.text.toLowerCase() === 'yo\'q' || msg.text.toLowerCase() === 'yok') ? null : msg.text;
                saveDb();
                bot.sendMessage(chatId, 'Mahsulot rasmi tahrirlandi!');
                showAdminProductsMenu(chatId, state.originalMessageId);
                delete userStates[chatId];
                break;

            // --- Category Add/Edit Flow ---
            case 'admin_add_category_name':
                const newCategory = { id: 'cat' + generateUniqueId(), name: msg.text };
                db.categories.push(newCategory);
                saveDb();
                bot.sendMessage(chatId, `Kategoriya "${msg.text}" qo'shildi!`);
                delete userStates[chatId];
                showAdminCategoriesMenu(chatId);
                break;
            case 'admin_edit_category_name':
                state.category.name = msg.text;
                saveDb();
                bot.sendMessage(chatId, 'Kategoriya nomi tahrirlandi!');
                delete userStates[chatId];
                showAdminCategoriesMenu(chatId, state.originalMessageId);
                break;
        }
    } else { // --- Логика для Клиента ---
        switch (state.action) {
            case 'awaiting_comment':
                userStates[chatId].comment = msg.text;
                userStates[chatId].action = undefined; // Clear action
                bot.sendMessage(chatId, 'Izohingiz saqlandi.');
                showCart(chatId); // Return to cart
                break;

            case 'awaiting_product_amount':
                const amount = parseInt(msg.text, 10);
                if (isNaN(amount) || amount <= 0) {
                    bot.sendMessage(chatId, 'Iltimos, to\'g\'ri summani kiriting (faqat raqam).');
                    return;
                }
                const product = findProductById(state.productId);
                if (product) {
                    if (!userCarts[chatId]) userCarts[chatId] = [];
                    userCarts[chatId].push({
                        id: `${product.id}_${Date.now()}`,
                        productId: product.id,
                        name: `${product.name} (${amount.toLocaleString('uz-UZ')} so'm)`,
                        quantity: 1, // Quantity is 1 for "by_amount" items
                        price: amount, // The price is the entered amount
                        type: 'by_amount'
                    });
                    bot.sendMessage(chatId, `✅ ${amount.toLocaleString('uz-UZ')} so'mlik ${product.name} savatga qo'shildi.`);
                }
                delete userStates[chatId];
                showCart(chatId);
                break;
        }
    }
=======
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const geolib = require('geolib');
const levenshtein = require('fast-levenshtein');
const util = require('util');

// ================================================================= //
// --- НАСТРОЙКИ ---
// ================================================================= //
const TOKEN = '7976277994:AAFOmpAk4pdD85U9kvhmI-lLhtziCyfGTUY';
const ADMIN_CHAT_ID = '5309814540';
const SUPPORT_PHONE = '+998914906787'; // ВАШ НОМЕР ТЕЛЕФОНА
const SUPPORT_USERNAME = '@Mukhammadyusuf6787'; // ВАШ ЮЗЕРНЕЙМ В ТЕЛЕГРАМ


const ADMIN_BTN_NEW = '🆕 Yangi buyurtmalar';
const ADMIN_BTN_ASSEMBLING = '🛠 Yig\'ilayotganlar';
const ADMIN_BTN_COMPLETED = '✅ Bajarilganlar';
const ADMIN_BTN_PRODUCTS = '📦 Mahsulotlar';

const ORDERS_FILE_PATH = 'orders.json';
const PRODUCTS_FILE_PATH = 'products.json';

const MIN_ORDER_AMOUNT = 50000;
const DELIVERY_PRICE = 5000;
const FREE_DELIVERY_THRESHOLD = 100000;
const MAX_DELIVERY_RADIUS_KM = 2.5;

const SHOP_COORDINATES = { latitude: 40.764535, longitude: 72.282204 };
let db = JSON.parse(fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8'));

// ================================================================= //
// --- ИНИЦИАЛИЗАЦИЯ БОТА И ХРАНИЛИЩ ---
// ================================================================= //
const bot = new TelegramBot(TOKEN, { polling: true });
const userCarts = {};
const userStates = {};

console.log('"One Mart" (v.Final with Full Admin) ishga tushirildi...');

// ================================================================= //
// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
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
    if (data.startsWith('admin_')) { const parts = data.split('_'); const action = parts[1]; const orderId = parseInt(parts.pop(), 10); if (action === 'view') { const order = readOrders().find(o => o.order_id === orderId); if (!order) { bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi!', show_alert: true }); return; } let details = `--- Buyurtma #${order.order_number} ---\n`; details += `Sana: ${new Date(order.date).toLocaleString('ru-RU')}\nMijoz raqami: ${order.customer_phone}\nHolat: ${getStatusText(order.status)}\n\n`; if (order.comment) { details += `Izoh: ${order.comment}\n\n`; } details += `Mahsulotlar:\n`; order.cart.forEach(item => { details += `- ${item.name} ${item.quantity ? `x ${item.quantity}` : ''}\n`; }); const { latitude, longitude } = order.location; details += `\nJami: ${order.total.toLocaleString('uz-UZ')} so'm\n📍 Manzil: http://googleusercontent.com/maps/google.com/0{latitude},${longitude}`; const statusButtons = []; if (order.status === 'new') { statusButtons.push({ text: '🛠 Yig\'ishni boshlash', callback_data: `admin_set_status_assembling_${order.order_id}` }); const now = new Date(); if (now.getHours() < 16) { statusButtons.push({ text: '❌ Bekor qilish', callback_data: `admin_set_status_cancelled_${order.order_id}` }); } } if (order.status === 'assembling') { statusButtons.push({ text: '✅ Tayyor', callback_data: `admin_set_status_ready_${order.order_id}` }); } if (order.status === 'ready') { statusButtons.push({ text: '🚚 Yetkazib berish', callback_data: `admin_set_status_delivering_${order.order_id}` }); } if (order.status === 'delivering') { statusButtons.push({ text: '🏁 Yetkazib berildi', callback_data: `admin_set_status_completed_${order.order_id}` }); } bot.sendMessage(chatId, details, { reply_markup: { inline_keyboard: [statusButtons] } }); } else if (action === 'set') { const newStatus = parts[2]; const allOrders = readOrders(); const orderIndex = allOrders.findIndex(o => o.order_id === orderId); if (orderIndex === -1) return; allOrders[orderIndex].status = newStatus; writeOrders(allOrders); const updatedOrder = allOrders[orderIndex]; bot.editMessageText(`Buyurtma #${updatedOrder.order_number} holati "${getStatusText(newStatus)}" ga o'zgartirildi.`, { chat_id: chatId, message_id: messageId }).catch(() => {}); const customerMessage = `Hurmatli mijoz, sizning #${updatedOrder.order_number} raqamli buyurtmangiz holati o'zgardi.\n\nYangi holat: **${getStatusText(newStatus)}**`; bot.sendMessage(updatedOrder.customer_chat_id, customerMessage, { parse_mode: 'Markdown' }); } bot.answerCallbackQuery(query.id); return; }
    if (data === 'back_to_categories') { showCategories(chatId, messageId); bot.answerCallbackQuery(query.id); return; }
    if (data.startsWith('category_')) { const categoryId = data.substring('category_'.length); if (query.message.photo) { await bot.deleteMessage(chatId, messageId).catch(() => {}); showProductsByCategory(chatId, categoryId); } else { showProductsByCategory(chatId, categoryId, messageId); } bot.answerCallbackQuery(query.id); return; }
    if (data.startsWith('product_')) { const productId = parseInt(data.split('_')[1], 10); const product = findProductById(productId); if (!product) { bot.answerCallbackQuery(query.id); return; } await bot.deleteMessage(chatId, messageId).catch(()=>{}); if (product.pricing_model === 'by_amount') { userStates[chatId] = { ...userStates[chatId], action: 'awaiting_product_amount', productId: productId }; const caption = `'${product.name}' uchun kerakli summani kiriting (masalan, 15000):\n\nBekor qilish uchun /cancel yozing.`; if (product.photo_url && product.photo_url.startsWith('http')) { bot.sendPhoto(chatId, product.photo_url, { caption: caption }); } else { bot.sendMessage(chatId, caption); } } else { showQuantitySelector(chatId, product, 1); } bot.answerCallbackQuery(query.id); return; }
    if (data.startsWith('increase_') || data.startsWith('decrease_')) { const parts = data.split('_'); const action = parts[0]; const productId = parseInt(parts[1], 10); let quantity = parseInt(parts[2], 10); const product = findProductById(productId); if (!product) { bot.answerCallbackQuery(query.id); return; } if (action === 'increase') { quantity++; } else if (action === 'decrease' && quantity > 1) { quantity--; } updateQuantitySelector(chatId, messageId, product, quantity); bot.answerCallbackQuery(query.id); return; }
    if (data.startsWith('addToCart_')) { const parts = data.split('_'); const productId = parseInt(parts[1], 10); const quantity = parseInt(parts[2], 10); const product = findProductById(productId); if (!product) { bot.answerCallbackQuery(query.id); return; } if (!userCarts[chatId]) { userCarts[chatId] = []; } const existingProductIndex = userCarts[chatId].findIndex(item => item.productId === productId); if (existingProductIndex > -1) { userCarts[chatId][existingProductIndex].quantity += quantity; } else { userCarts[chatId].push({ id: `${product.id}_${Date.now()}`, productId: product.id, name: product.name, quantity: quantity, price: product.price, type: 'standard' }); } bot.answerCallbackQuery(query.id, { text: `✅ ${product.name} (${quantity} dona) savatga qo'shildi!` }); await bot.deleteMessage(chatId, messageId).catch(() => {}); showCategories(chatId); return; }
    if (data === 'confirm_order') { const cart = userCarts[chatId]; const state = userStates[chatId]; if (!cart || !state || !state.phone || !state.location) { bot.answerCallbackQuery(query.id, { text: "Xatolik yuz berdi...", show_alert: true }); return; } const { newOrderId, newOrderNumber } = saveOrderToJson(chatId, cart, state); const orderTime = new Date(); let deliveryMessage; if (orderTime.getHours() >= 19) { deliveryMessage = "Sizning buyurtmangiz ertaga 19:30 dan keyin yetkazib beriladi."; } else { deliveryMessage = "Sizning buyurtmangiz bugun 19:30 dan keyin yetkazib beriladi."; } let adminMessage = `🔔 Yangi buyurtma! #${newOrderNumber}\n\n`; adminMessage += `Mijoz raqami: ${state.phone}\n\n`; if (state.comment) { adminMessage += `Izoh: ${state.comment}\n\n`; } cart.forEach(item => { adminMessage += `▪️ ${item.name} ${item.quantity ? `x ${item.quantity}` : ''}\n`; }); adminMessage += `\nJami: ${state.total.toLocaleString('uz-UZ')} so'm\n`; const { latitude, longitude } = state.location; adminMessage += `📍 Manzil: http://googleusercontent.com/maps/google.com/0{latitude},${longitude}`; bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { reply_markup: { inline_keyboard: [[{ text: `Buyurtmani ko'rish (#${newOrderNumber})`, callback_data: `admin_view_order_${newOrderId}` }]] } }); await bot.deleteMessage(chatId, messageId).catch(()=>{}); bot.sendMessage(chatId, `Rahmat! Sizning #${newOrderNumber} raqamli buyurtmangiz qabul qilindi.\n\n${deliveryMessage}\n\nHolatini /status buyrug'i orqali kuzatishingiz mumkin.`, { reply_markup: { keyboard: [[{ text: "🛍️ Mahsulotlar katalogi" }, { text: "🛒 Savat" }], [{ text: "📞 Podderjka" }, { text: "🔄 Yangilash" }]], resize_keyboard: true } }); userCarts[chatId] = []; delete userStates[chatId]; bot.answerCallbackQuery(query.id); return; }
    if (data === 'leave_comment') { userStates[chatId] = { ...userStates[chatId], action: 'awaiting_comment' }; bot.answerCallbackQuery(query.id); bot.sendMessage(chatId, 'Buyurtmangizga izoh yozing:'); return; }
    if (data.startsWith('cart_')) { const parts = data.split('_'); const action = parts[1]; const cartItemId = parts.slice(2).join('_'); const cart = userCarts[chatId]; if (!cart) { bot.answerCallbackQuery(query.id); return; } const productIndex = cart.findIndex(item => item.id.toString() === cartItemId.toString()); if (productIndex === -1) { bot.answerCallbackQuery(query.id); return; } const item = cart[productIndex]; if (item.type === 'standard') { if (action === 'incr') { item.quantity++; } else if (action === 'decr') { if (item.quantity > 1) { item.quantity--; } else { cart.splice(productIndex, 1); } } } if (action === 'del') { cart.splice(productIndex, 1); } showCart(chatId, messageId); bot.answerCallbackQuery(query.id); }
    else if (data === 'clear_cart') { userCarts[chatId] = []; showCart(chatId, messageId); bot.answerCallbackQuery(query.id, { text: 'Savat tozalandi!' }); }
    else if (data === 'checkout') { const cart = userCarts[chatId]; if (!cart || cart.length === 0) { bot.answerCallbackQuery(query.id, { text: 'Sizning savatingiz bo\'sh!', show_alert: true }); return; } const total = cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0); if (total < MIN_ORDER_AMOUNT) { bot.answerCallbackQuery(query.id, { text: `Minimal buyurtma miqdori ${MIN_ORDER_AMOUNT.toLocaleString('uz-UZ')} so'm.`, show_alert: true }); return; } bot.sendMessage(chatId, 'Yetkazib berish uchun telefon raqamingizni yuboring.', { reply_markup: { keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]], one_time_keyboard: true, resize_keyboard: true } }); bot.answerCallbackQuery(query.id); }
    else if (data === 'cancel_order') { userCarts[chatId] = []; delete userStates[chatId]; bot.editMessageText("Buyurtmangiz bekor qilindi.", { chat_id: chatId, message_id: messageId }); }
    else { bot.answerCallbackQuery(query.id); }
});

bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) { return; }
    const chatId = msg.chat.id; const state = userStates[chatId];
    if (!state || !state.action) return;
    if (msg.text && msg.text.toLowerCase() === '/cancel') { if (state) { delete userStates[chatId]; bot.sendMessage(chatId, "Amal bekor qilindi."); } return; }
    
    if (state.action === 'awaiting_product_amount') {
        const amount = parseInt(msg.text, 10);
        if (isNaN(amount) || amount <= 0 || amount < 1000) { bot.sendMessage(chatId, `Xatolik! Iltimos, 1000 so'mdan yuqori, faqat musbat raqam yuboring.`); return; }
        const product = findProductById(state.productId);
        if (!product) { bot.sendMessage(chatId, "Xatolik: mahsulot topilmadi."); delete userStates[chatId]; return; }
        if (!userCarts[chatId]) { userCarts[chatId] = []; }
        const cartItemId = `${product.id}_${Date.now()}`;
        userCarts[chatId].push({ id: cartItemId, productId: product.id, name: `${product.name} (${amount.toLocaleString('uz-UZ')} so'm)`, price: amount, type: 'by_amount' });
        bot.sendMessage(chatId, `✅ ${product.name} (${amount.toLocaleString('uz-UZ')} so'm) savatga qo'shildi!`);
        delete userStates[chatId];
        showCategories(chatId);
    } else if (state.action === 'awaiting_comment') {
        userStates[chatId] = { ...userStates[chatId], comment: msg.text, action: null };
        bot.sendMessage(chatId, "Izohingiz qabul qilindi!");
        showCart(chatId);
    }
>>>>>>> fce0dc2b4e9ea8449f3b290eda41695eaeb36839
});
