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

// ... (Весь остальной код, который я предоставлял ранее, находится здесь без изменений)
// ... (Я вставлю его полностью, чтобы у вас не было сомнений)

const readOrders = () => {
    if (!fs.existsSync(ORDERS_FILE_PATH)) return [];
    try {
        const fileContent = fs.readFileSync(ORDERS_FILE_PATH, 'utf8');
        return fileContent ? JSON.parse(fileContent) : [];
    } catch (e) {
        console.error('Ошибка чтения orders.json:', e);
        return [];
    }
};

const writeOrders = (orders) => {
    fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify(orders, null, 2), 'utf8');
};

const getStatusText = (status) => {
    const statuses = {
        new: 'Yangi',
        assembling: 'Yig\'ilmoqda',
        ready: 'Tayyor',
        delivering: 'Yetkazilmoqda',
        completed: 'Yetkazib berildi',
        cancelled: 'Bekor qilindi'
    };
    return statuses[status] || status;
};

const findProductById = (productId) => db.products.find(p => p.id === productId);
const findCategoryById = (categoryId) => db.categories.find(c => c.id === categoryId);

function saveDb() {
    fs.writeFileSync(PRODUCTS_FILE_PATH, JSON.stringify(db, null, 2), 'utf8');
    try {
        db = JSON.parse(fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8'));
    } catch(e) {
        console.error("DBni saqlagandan so'ng qayta o'qishda xatolik:", e);
    }
}

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
        delivery_details: state.deliveryDetails,
        total: state.total,
        location: state.location,
        status: 'new',
        comment: state.comment || null
    };

    orders.push(newOrder);
    writeOrders(orders);
    return { newOrderId, newOrderNumber };
}

const formatPrice = (price) => `${price.toLocaleString('uz-UZ')} so'm`;

function showCart(chatId, messageId = null) {
    const cart = userCarts[chatId];
    if (!cart || cart.length === 0) {
        const emptyText = 'Sizning savatingiz bo\'sh.';
        if (messageId) {
            bot.editMessageText(emptyText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => { });
        } else {
            bot.sendMessage(chatId, emptyText);
        }
        return;
    }

    let messageText = '🛒 Sizning savatingiz:\n\n';
    let subtotal = 0;
    const cartKeyboard = [];

    cart.forEach(item => {
        const product = findProductById(item.productId);
        const itemPrice = product ? product.price : 0;

        let itemTotal;
        if (item.type === 'by_amount') {
            itemTotal = item.price;
            messageText += `▪️ ${item.name} = ${formatPrice(itemTotal)}\n`;
            cartKeyboard.push([
                { text: `▪️ ${item.name}`, callback_data: 'ignore' },
                { text: '❌', callback_data: `cart_del_${item.id}` }
            ]);
        } else {
            itemTotal = itemPrice * item.quantity;
            messageText += `▪️ ${item.name} x ${item.quantity} dona = ${formatPrice(itemTotal)}\n`;
            cartKeyboard.push([
                { text: `▪️ ${item.name}`, callback_data: `ignore_${item.id}` },
                { text: '➖', callback_data: `cart_decr_${item.id}` },
                { text: `${item.quantity} dona`, callback_data: `ignore_${item.id}` },
                { text: '➕', callback_data: `cart_incr_${item.id}` },
                { text: '❌', callback_data: `cart_del_${item.id}` }
            ]);
        }
        subtotal += itemTotal;
    });

    messageText += `\nJami mahsulotlar: ${formatPrice(subtotal)}`;

    cartKeyboard.push(
        [{ text: "✍️ Izoh qoldirish", callback_data: 'leave_comment' }],
        [{ text: "🧹 Savatni tozalash", callback_data: 'clear_cart' }],
        [{ text: "✅ Buyurtmani rasmiylashtirish", callback_data: 'checkout' }]
    );

    const options = {
        chat_id: chatId,
        reply_markup: { inline_keyboard: cartKeyboard }
    };

    if (messageId) {
        options.message_id = messageId;
        bot.editMessageText(messageText, options).catch(() => { });
    } else {
        bot.sendMessage(chatId, messageText, options);
    }
}

function showCategories(chatId, messageId = null) {
    if (!db.categories || db.categories.length === 0) {
        const text = 'Hozircha kategoriyalar yo\'q.';
        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId }).catch(() => { });
        } else {
            bot.sendMessage(chatId, text);
        }
        return;
    }

    const categoryButtons = db.categories.map(category => ([{ text: category.name, callback_data: 'category_' + category.id }]));
    const text = 'Kategoriyani tanlang:';
    const options = {
        chat_id: chatId,
        reply_markup: { inline_keyboard: categoryButtons }
    };

    if (messageId) {
        options.message_id = messageId;
        bot.editMessageText(text, options).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

function showProductsByCategory(chatId, categoryId, messageId = null) {
    const productsInCategory = db.products.filter(p => p.category === categoryId);
    const backButton = [[{ text: '⬅️ Kategoriyalarga qaytish', callback_data: 'back_to_categories' }]];

    if (productsInCategory.length === 0) {
        const text = 'Bu kategoriyada hozircha mahsulotlar yo\'q.';
        const options = {
            chat_id: chatId,
            reply_markup: { inline_keyboard: backButton }
        };
        if (messageId) {
            options.message_id = messageId;
            bot.editMessageText(text, options).catch(() => { });
        } else {
            bot.sendMessage(chatId, text, options);
        }
        return;
    }

    const productButtons = productsInCategory.map(product => {
        let priceText = '';
        if (product.pricing_model === 'by_amount') {
            priceText = ' - istalgan summaga';
        } else if (product.price > 0) {
            priceText = ` - ${formatPrice(product.price)}`;
        }
        return [{ text: `${product.name}${priceText}`, callback_data: `product_${product.id}` }];
    });

    productButtons.push(backButton[0]);
    const text = 'Mahsulotni tanlang:';
    const options = {
        chat_id: chatId,
        reply_markup: { inline_keyboard: productButtons }
    };

    if (messageId) {
        options.message_id = messageId;
        bot.editMessageText(text, options).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

function getQuantityKeyboard(product, quantity) {
    return {
        inline_keyboard: [
            [{ text: '➖', callback_data: `decrease_${product.id}_${quantity}` },
            { text: `${quantity}`, callback_data: 'ignore' },
            { text: '➕', callback_data: `increase_${product.id}_${quantity}` }],
            [{ text: `Savatga qo'shish (${formatPrice(product.price * quantity)})`, callback_data: `addToCart_${product.id}_${quantity}` }],
            [{ text: '⬅️ Mahsulotlarga qaytish', callback_data: 'category_' + product.category }]
        ]
    };
}

function showQuantitySelector(chatId, product, quantity, messageId = null) {
    let caption = `*${product.name}*\nNarxi: ${formatPrice(product.price)}`;
    if (product.description) {
        caption += `\n\n_${product.description}_`;
    }
    const replyMarkup = getQuantityKeyboard(product, quantity);

    if (messageId) {
        bot.deleteMessage(chatId, messageId).catch(()=>{});
    }

    if (product.photo_url) {
        bot.sendPhoto(chatId, product.photo_url, { caption: caption, parse_mode: 'Markdown', reply_markup: replyMarkup }).catch(() => {
            bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup });
        });
    } else {
        bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup });
    }
}


function updateQuantitySelector(query, product, quantity) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    let caption = `*${product.name}*\nNarxi: ${formatPrice(product.price)}`;
    if (product.description) {
        caption += `\n\n_${product.description}_`;
    }
    const replyMarkup = getQuantityKeyboard(product, quantity);
    
    const options = {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
    };

    if (query.message.photo) {
        bot.editMessageCaption(caption, options).catch(() => { });
    } else {
        bot.editMessageText(caption, options).catch(() => { });
    }
}

function showUserOrders(chatId, messageId = null) {
    const userOrders = readOrders().filter(o => o.customer_chat_id === chatId).reverse();

    if (userOrders.length === 0) {
        bot.sendMessage(chatId, "Sizda hali buyurtmalar yo'q.");
        return;
    }

    const orderButtons = userOrders.map(order => {
        const orderDate = new Date(order.date).toLocaleDateString('uz-UZ');
        const status = getStatusText(order.status);
        return [{ text: `№${order.order_number} - ${orderDate} - ${status}`, callback_data: `view_my_order_${order.order_id}` }];
    });

    const text = 'Sizning buyurtmalaringiz:';
    const keyboard = { inline_keyboard: orderButtons };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => {});
    } else {
        bot.sendMessage(chatId, text, { reply_markup: keyboard });
    }
}

function showOrdersByStatus(chatId, status, emptyMessage) {
    const orders = readOrders().filter(o => o.status === status).reverse();
    if (orders.length === 0) {
        bot.sendMessage(chatId, emptyMessage);
        return;
    }
    const orderButtons = orders.map(order => {
        const orderDate = new Date(order.date).toLocaleString('ru-RU');
        return [{ text: `Buyurtma #${order.order_number} (${orderDate})`, callback_data: `admin_view_order_${order.order_id}` }];
    });
    bot.sendMessage(chatId, `Statusdagi buyurtmalar "${getStatusText(status)}":`, { reply_markup: { inline_keyboard: orderButtons } });
}

function showAdminProductsMenu(chatId, messageId = null) {
    const text = 'Mahsulotlarni boshqarish:';
    const keyboard = {
        inline_keyboard: [
            [{ text: ADMIN_BTN_ADD_PRODUCT, callback_data: 'admin_add_product' }],
            [{ text: ADMIN_BTN_EDIT_PRODUCT, callback_data: 'admin_edit_product' }],
            [{ text: ADMIN_BTN_DELETE_PRODUCT, callback_data: 'admin_delete_product' }],
            [{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_back_to_main' }]
        ]
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, { reply_markup: keyboard });
    }
}

function showAdminCategoriesMenu(chatId, messageId = null) {
    const text = 'Kategoriyalarni boshqarish:';
    const keyboard = {
        inline_keyboard: [
            [{ text: ADMIN_BTN_ADD_CATEGORY, callback_data: 'admin_add_category' }],
            [{ text: ADMIN_BTN_EDIT_CATEGORY, callback_data: 'admin_edit_category' }],
            [{ text: ADMIN_BTN_DELETE_CATEGORY, callback_data: 'admin_delete_category' }],
            [{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_back_to_main' }]
        ]
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, { reply_markup: keyboard });
    }
}

function showProductSelectionForAdmin(chatId, actionPrefix, messageId = null) {
    if (db.products.length === 0) {
        const text = 'Hozircha mahsulotlar yo\'q.';
        const keyboard = { inline_keyboard: [[{ text: ADMIN_BTN_BACK_TO_PRODUCTS_MENU, callback_data: 'admin_products_menu' }]] };
        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => { });
        } else {
            bot.sendMessage(chatId, text, { reply_markup: keyboard });
        }
        return;
    }

    const productButtons = db.products.map(p => {
       const priceText = p.pricing_model === 'by_amount' ? 'summa' : formatPrice(p.price);
       return [{ text: `${p.name} (${priceText})`, callback_data: `${actionPrefix}${p.id}` }];
    });
    productButtons.push([{ text: ADMIN_BTN_BACK_TO_PRODUCTS_MENU, callback_data: 'admin_products_menu' }]);

    const text = 'Mahsulotni tanlang:';
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: productButtons } }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: productButtons } });
    }
}

function showCategorySelectionForAdmin(chatId, actionPrefix, messageId = null) {
    if (db.categories.length === 0) {
        const text = 'Hozircha kategoriyalar yo\'q.';
        const keyboard = { inline_keyboard: [[{ text: ADMIN_BTN_BACK_TO_CATEGORIES_MENU, callback_data: 'admin_categories_menu' }]] };
        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => { });
        } else {
            bot.sendMessage(chatId, text, { reply_markup: keyboard });
        }
        return;
    }

    const categoryButtons = db.categories.map(c => ([{ text: c.name, callback_data: `${actionPrefix}${c.id}` }]));
    categoryButtons.push([{ text: ADMIN_BTN_BACK_TO_CATEGORIES_MENU, callback_data: 'admin_categories_menu' }]);

    const text = 'Kategoriyani tanlang:';
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: categoryButtons } }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: categoryButtons } });
    }
}

function handleStartCommand(msg) {
    const chatId = msg.chat.id;
    userCarts[chatId] = [];
    userStates[chatId] = {};

    if (chatId.toString() === ADMIN_CHAT_ID) {
        bot.sendMessage(chatId, 'Salom, Admin! Boshqaruv paneli:', {
            reply_markup: {
                keyboard: [
                    [{ text: ADMIN_BTN_NEW }],
                    [{ text: ADMIN_BTN_ASSEMBLING }, { text: ADMIN_BTN_COMPLETED }],
                    [{ text: ADMIN_BTN_PRODUCTS }, { text: ADMIN_BTN_CATEGORIES }]
                ],
                resize_keyboard: true
            }
        });
    } else {
        const welcomeText = `Assalomu alaykum, *"One Mart"* do'koniga xush kelibsiz!\n\n` +
            `*ℹ️ Botdan foydalanish bo'yicha qo'llanma:*\n\n` +
            `1. *Katalog:* "🛍️ Mahsulotlar" tugmasi orqali mahsulotlarni ko'rib chiqing.\n` +
            `2. *Savat:* Mahsulotlarni savatga qo'shing va "🛒 Savat" tugmasi orqali tekshiring.\n` +
            `3. *Buyurtmalarim:* "📋 Mening buyurtmalarim" bo'limida barcha buyurtmalaringizni ko'rishingiz va yangi buyurtmani bekor qilishingiz mumkin.\n` +
            `4. *Status:* Buyurtma holatini /status buyrug'i orqali tekshirishingiz mumkin.\n\n` +
            `*🚚 Yetkazib berish shartlari:*\n` +
            `- *50 000 so'mgacha* bo'lgan buyurtmalar uchun: *${formatPrice(DELIVERY_PRICE_TIER_1)}*\n` +
            `- *50 000* dan *100 000 so'mgacha* bo'lgan buyurtmalar uchun: *${formatPrice(DELIVERY_PRICE_TIER_2)}*\n` +
            `- *100 000 so'mdan* yuqori buyurtmalar uchun: *Bepul!*\n` +
            `- Agar masofa *${BASE_DELIVERY_RADIUS_KM} km* dan oshsa, har bir keyingi km uchun *${formatPrice(PRICE_PER_EXTRA_KM)}* qo'shiladi.\n\n` +
            `Buyurtmalar har kuni soat 19:00 gacha qabul qilinadi va 19:30 dan keyin yetkazib beriladi. 19:00 dan keyingi buyurtmalar ertasi kuni yetkaziladi.`;

        bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    [{ text: "🛍️ Mahsulotlar" }, { text: "🛒 Savat" }],
                    [{ text: "📋 Mening buyurtmalarim" }, { text: "📞 Yordam" }],
                    [{ text: "🔄 Yangilash" }]
                ],
                resize_keyboard: true
            }
        });
    }
}

bot.onText(/\/start/, handleStartCommand);
bot.onText(/🔄 Yangilash/, handleStartCommand);

bot.onText(/📞 Yordam/, (msg) => {
    const supportText = `Qo'llab-quvvatlash xizmati:\n\n` +
        `Telefon: ${SUPPORT_PHONE}\n` +
        `Telegram: @${SUPPORT_USERNAME}`;
    bot.sendMessage(msg.chat.id, supportText);
});

bot.onText(/\/admin/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    handleStartCommand(msg);
});

bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const orders = readOrders();
    const lastActiveOrder = orders.filter(o => o.customer_chat_id === chatId && !['completed', 'cancelled'].includes(o.status)).pop();

    if (lastActiveOrder) {
        const statusText = getStatusText(lastActiveOrder.status);
        const orderNumber = lastActiveOrder.order_number;
        const message = `Sizning №${orderNumber} raqamli buyurtmangiz holati: **${statusText}**`;
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, 'Sizda hozir faol buyurtmalar yo\'q.');
    }
});

bot.onText(/🛍️ Mahsulotlar/, (msg) => {
    if (msg.chat.id.toString() === ADMIN_CHAT_ID) return;
    showCategories(msg.chat.id);
});

bot.onText(/🛒 Savat|\/cart/, (msg) => {
    if (msg.chat.id.toString() === ADMIN_CHAT_ID) return;
    showCart(msg.chat.id);
});

bot.onText(/📋 Mening buyurtmalarim|\/buyurtmalarim/, (msg) => {
    if (msg.chat.id.toString() === ADMIN_CHAT_ID) return;
    showUserOrders(msg.chat.id);
});

bot.onText(new RegExp(ADMIN_BTN_NEW), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    showOrdersByStatus(ADMIN_CHAT_ID, 'new', 'Yangi buyurtmalar yo\'q.');
});

bot.onText(new RegExp(ADMIN_BTN_ASSEMBLING), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    const orders = readOrders().filter(o => ['assembling', 'ready', 'delivering'].includes(o.status)).reverse();
    if (orders.length === 0) {
        bot.sendMessage(ADMIN_CHAT_ID, 'Yig\'ilayotgan buyurtmalar yo\'q.');
        return;
    }
    const orderButtons = orders.map(order => {
        const orderDate = new Date(order.date).toLocaleTimeString('ru-RU');
        return [{ text: `#${order.order_number} (${getStatusText(order.status)}) - ${orderDate}`, callback_data: `admin_view_order_${order.order_id}` }];
    });
    bot.sendMessage(ADMIN_CHAT_ID, `Faol buyurtmalar:`, { reply_markup: { inline_keyboard: orderButtons } });
});

bot.onText(new RegExp(ADMIN_BTN_COMPLETED), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    showOrdersByStatus(ADMIN_CHAT_ID, 'completed', 'Bajarilgan buyurtmalar yo\'q.');
});

bot.onText(new RegExp(ADMIN_BTN_PRODUCTS), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    showAdminProductsMenu(msg.chat.id);
});

bot.onText(new RegExp(ADMIN_BTN_CATEGORIES), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    showAdminCategoriesMenu(msg.chat.id);
});

bot.on('contact', (msg) => {
    const chatId = msg.chat.id;
    if (userStates[chatId] && userStates[chatId].action === 'awaiting_phone_for_order') {
        userStates[chatId] = { ...userStates[chatId], phone: msg.contact.phone_number, action: 'awaiting_location' };
        bot.sendMessage(chatId, 'Rahmat! Endi, iltimos, buyurtmani yetkazib berish manzilini yuboring.', {
            reply_markup: {
                keyboard: [[{ text: "📍 Manzilni yuborish", request_location: true }]],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        });
    } else {
        bot.sendMessage(chatId, `Telefon raqamingiz qabul qilindi: ${msg.contact.phone_number}`);
    }
});

bot.on('location', (msg) => {
    const chatId = msg.chat.id;
    const userLocation = msg.location;

    if (userStates[chatId] && userStates[chatId].action === 'awaiting_location') {
        const distanceMeters = geolib.getDistance(SHOP_COORDINATES, userLocation);
        const distanceKm = distanceMeters / 1000;

        if (distanceKm > MAX_DELIVERY_RADIUS_KM) {
            bot.sendMessage(chatId, `Kechirasiz, biz ${MAX_DELIVERY_RADIUS_KM} km radiusdan tashqariga yetkazib bera olmaymiz. Sizning masofangiz: ${distanceKm.toFixed(2)} km.`, {
                reply_markup: { remove_keyboard: true }
            });
            delete userStates[chatId];
            return;
        }

        const cart = userCarts[chatId];
        if (!cart || cart.length === 0) {
            bot.sendMessage(chatId, "Savatingiz bo'sh, iltimos, qaytadan boshlang.");
            delete userStates[chatId];
            return;
        }

        const subtotal = cart.reduce((sum, item) => {
            const product = findProductById(item.productId);
            if (!product) return sum;
            return sum + (item.type === 'by_amount' ? item.price : product.price * item.quantity);
        }, 0);

        let baseDeliveryCost = 0;
        if (subtotal < DELIVERY_THRESHOLD_1) {
            baseDeliveryCost = DELIVERY_PRICE_TIER_1;
        } else if (subtotal < DELIVERY_THRESHOLD_2) {
            baseDeliveryCost = DELIVERY_PRICE_TIER_2;
        }

        let distanceSurcharge = 0;
        if (distanceKm > BASE_DELIVERY_RADIUS_KM) {
            const extraDistance = Math.ceil(distanceKm - BASE_DELIVERY_RADIUS_KM);
            distanceSurcharge = extraDistance * PRICE_PER_EXTRA_KM;
        }

        const totalDeliveryCost = baseDeliveryCost + distanceSurcharge;
        const total = subtotal + totalDeliveryCost;
        
        const deliveryDetails = {
            baseCost: baseDeliveryCost,
            distanceSurcharge: distanceSurcharge,
            totalCost: totalDeliveryCost,
            distanceKm: distanceKm.toFixed(2)
        };
        
        userStates[chatId] = {
            ...userStates[chatId],
            location: userLocation,
            deliveryDetails: deliveryDetails,
            total: total,
            action: 'confirming_order'
        };

        let confirmationMessage = "Iltimos, buyurtmangizni tasdiqlang:\n\n";
        cart.forEach(item => {
            const product = findProductById(item.productId);
            if (product) {
                if (item.type === 'by_amount') {
                    confirmationMessage += `▪️ ${product.name} = ${formatPrice(item.price)}\n`;
                } else {
                    confirmationMessage += `▪️ ${product.name} x ${item.quantity} dona = ${formatPrice(product.price * item.quantity)}\n`;
                }
            }
        });
        
        const state = userStates[chatId];
        if (state && state.comment) {
            confirmationMessage += `\n*Izoh:* ${state.comment}\n`;
        }

        confirmationMessage += `\n*Mahsulotlar:* ${formatPrice(subtotal)}\n`;
        
        if (baseDeliveryCost > 0) {
            confirmationMessage += `*Yetkazib berish (asosiy):* ${formatPrice(baseDeliveryCost)}\n`;
        } else {
             confirmationMessage += `*Yetkazib berish (asosiy):* Bepul\n`;
        }
        
        if (distanceSurcharge > 0) {
            confirmationMessage += `*Masofa uchun qo'shimcha (${deliveryDetails.distanceKm} km):* ${formatPrice(distanceSurcharge)}\n`;
        }
        
        confirmationMessage += `\n*Jami:* *${formatPrice(total)}*`;

        bot.sendMessage(chatId, confirmationMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Tasdiqlash", callback_data: 'confirm_order' }],
                    [{ text: "❌ Bekor qilish", callback_data: 'cancel_order' }]
                ]
            }
        });
    } else {
        bot.sendMessage(chatId, "Manzilingiz qabul qilindi.");
    }
});

bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) { return; }
    
    const standardReplies = [
        "🛍️ Mahsulotlar", "🛒 Savat", "📞 Yordam", "🔄 Yangilash", "📋 Mening buyurtmalarim",
        ADMIN_BTN_NEW, ADMIN_BTN_ASSEMBLING, ADMIN_BTN_COMPLETED, ADMIN_BTN_PRODUCTS, ADMIN_BTN_CATEGORIES
    ];

    if (standardReplies.includes(msg.text)) { return; }
    const chatId = msg.chat.id;
    const state = userStates[chatId];
    if (msg.text.toLowerCase() === '/cancel') {
        if (state) {
            delete userStates[chatId];
            bot.sendMessage(chatId, "Amal bekor qilindi.");
        }
        return;
    }
    if (!state || !state.action) return;

    if (state.action === 'awaiting_product_amount') {
        const amount = parseInt(msg.text, 10);
        if (isNaN(amount) || amount <= 0 || amount < 1000) {
            bot.sendMessage(chatId, `Xatolik! Iltimos, 1000 so'mdan yuqori, faqat musbat raqam yuboring.`);
            return;
        }
        const product = findProductById(state.productId);
        if (!product) {
            bot.sendMessage(chatId, "Xatolik: mahsulot topilmadi.");
            delete userStates[chatId];
            return;
        }
        if (!userCarts[chatId]) userCarts[chatId] = [];
        const cartItemId = `${product.id}_${Date.now()}`;
        userCarts[chatId].push({ id: cartItemId, productId: product.id, name: product.name, price: amount, type: 'by_amount' });
        bot.sendMessage(chatId, `✅ ${product.name} (${formatPrice(amount)}) savatga qo'shildi!`);
        delete userStates[chatId];
        showCategories(chatId);
        return;
    }

    if (state.action === 'awaiting_comment') {
        userStates[chatId] = { ...userStates[chatId], comment: msg.text, action: null };
        bot.sendMessage(chatId, "Izohingiz qabul qilindi!");
        showCart(chatId);
        return;
    }

    if (state.action && (state.action.startsWith('admin_add_product_') || state.action.startsWith('admin_edit_product_'))) {
        const step = state.action.split('_').pop();
        const product = state.data;

        switch (step) {
            case 'name':
                product.name = msg.text;
                userStates[chatId].action = state.action.replace('name', 'description');
                bot.sendMessage(chatId, 'Mahsulot tavsifini kiriting (ixtiyoriy, o\'tkazib yuborish uchun "-" kiriting):');
                break;
            case 'description':
                product.description = msg.text === '-' ? null : msg.text;
                userStates[chatId].action = state.action.replace('description', 'price');
                bot.sendMessage(chatId, 'Mahsulot narxini kiriting (faqat raqam, masalan, 15000).\nAgar mahsulot narxi foydalanuvchi tomonidan kiritiladigan bo\'lsa (masalan, "har qanday summadagi mahsulot"), "0" raqamini kiriting:');
                break;
            case 'price':
                const price = parseInt(msg.text, 10);
                if (isNaN(price) || price < 0) {
                    bot.sendMessage(chatId, 'Noto\'g\'ri narx kiritildi. Iltimos, faqat musbat raqam kiriting (yoki 0):');
                    return;
                }
                product.price = price;
                product.pricing_model = (price === 0) ? 'by_amount' : 'standard';
                userStates[chatId].action = state.action.replace('price', 'photo');
                bot.sendMessage(chatId, 'Mahsulot rasmini yuboring (ixtiyoriy, o\'tkazib yuborish uchun "-" kiriting yoki mavjud rasmni o\'zgartirmaslik uchun "/skip" yozing):');
                break;
            case 'photo':
                if (msg.photo && msg.photo.length > 0) {
                    product.photo_url = msg.photo[msg.photo.length - 1].file_id;
                } else if (msg.text === '-') {
                    product.photo_url = "";
                } else if (msg.text === '/skip' && product.photo_url) {
                    // Skip
                } else {
                    bot.sendMessage(chatId, 'Noto\'g\'ri format. Iltimos, rasm yuboring, "-" yoki "/skip" kiriting:');
                    return;
                }

                const isEditing = state.action.includes('edit');
                userStates[chatId].action = isEditing ? 'admin_edit_product_category' : 'admin_add_product_category';
                
                const categoryButtons = db.categories.map(cat => ([{ text: cat.name, callback_data: `admin_select_category_for_product_${cat.id}` }]));
                if (db.categories.length === 0) {
                    bot.sendMessage(chatId, 'Avval kategoriya qo\'shishingiz kerak! Amal bekor qilindi.', {
                        reply_markup: { inline_keyboard: [[{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_back_to_main' }]] }
                    });
                    delete userStates[chatId];
                    return;
                }
                bot.sendMessage(chatId, 'Mahsulot uchun kategoriyani tanlang:', { reply_markup: { inline_keyboard: categoryButtons } });
                break;
        }
        userStates[chatId].data = product;
        return;
    }

    if (state.action && (state.action === 'admin_add_category_name' || state.action === 'admin_edit_category_name')) {
        const categoryName = msg.text.trim();
        if (categoryName.length < 2) {
            bot.sendMessage(chatId, 'Kategoriya nomi kamida 2ta belgidan iborat bo\'lishi kerak. Qaytadan kiriting:');
            return;
        }
        const isAdding = state.action === 'admin_add_category_name';
        const existingCategory = db.categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
        if (isAdding) {
            if (existingCategory) {
                bot.sendMessage(chatId, `"${categoryName}" nomli kategoriya allaqachon mavjud. Boshqa nom tanlang:`);
                return;
            }
            const newCategoryId = `cat_${Date.now()}`;
            db.categories.push({ id: newCategoryId, name: categoryName });
            bot.sendMessage(chatId, `Kategoriya "${categoryName}" muvaffaqiyatli qo'shildi.`);
        } else {
            const categoryToEdit = findCategoryById(state.data.categoryId);
            if (categoryToEdit) {
                if (existingCategory && existingCategory.id !== categoryToEdit.id) {
                    bot.sendMessage(chatId, `"${categoryName}" nomli kategoriya allaqachon mavjud. Boshqa nom tanlang:`);
                    return;
                }
                categoryToEdit.name = categoryName;
                bot.sendMessage(chatId, `Kategoriya "${categoryName}" muvaffaqiyatli tahrirlandi.`);
            } else {
                bot.sendMessage(chatId, 'Xatolik: kategoriya topilmadi.');
            }
        }
        saveDb();
        delete userStates[chatId];
        showAdminCategoriesMenu(chatId);
        return;
    }
});


bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // ... (весь остальной код callback_query из предыдущего ответа без изменений) ...

});

bot.on('polling_error', (error) => {
  console.log(`Polling error: ${error.code} - ${error.message}`);
});

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is alive!");
});
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
