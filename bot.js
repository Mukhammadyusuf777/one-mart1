const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const geolib = require('geolib');
const levenshtein = require('fast-levenshtein');
const util = require('util');

// ================================================================= //
// --- НАСТРОЙКИ ---
// ================================================================= //
// !!! ВАЖНО: ЗАМЕНИТЕ ЭТИ ЗНАЧЕНИЯ СВОИМИ АКТУАЛЬНЫМИ ДАННЫМИ !!!
const TOKEN = process.env.TOKEN || '7976277994:AAFOmpAk4pdD85U9kvhmI-lLhtziCyfGTUY'; // Используйте process.env для Heroku, или вставьте напрямую для локального тестирования
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '5309814540'; // Используйте process.env для Heroku, или вставьте напрямую
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+998914906787'; // Номер телефона поддержки
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || 'Mukhammadyusuf6787'; // Юзернейм поддержки (без @)

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
const PRODUCTS_FILE_PATH = 'products.json'; // Используется для хранения категорий и товаров

// --- ПРАВИЛА ДОСТАВКИ ---
const MIN_ORDER_AMOUNT = 50000; // Минимальная сумма заказа
const DELIVERY_PRICE = 8000;    // Базовая стоимость доставки
const FREE_DELIVERY_THRESHOLD = 100000; // Сумма, после которой доставка бесплатна
const MAX_DELIVERY_RADIUS_KM = 10; // Максимальный радиус доставки от магазина

// --- Координаты магазина (центр для расчета доставки) ---
const SHOP_COORDINATES = { latitude: 40.764535, longitude: 72.282204 };

// ================================================================= //
// --- ИНИЦИАЛИЗАЦ ИЯ БОТА И ХРАНИЛИЩ ---
// ================================================================= //
const bot = new TelegramBot(TOKEN, { polling: true });

// Инициализация базы данных (товары и категории)
let db = {
    products: [],
    categories: []
};

// Проверяем, существует ли файл PRODUCTS_FILE_PATH, если нет - создаем
if (!fs.existsSync(PRODUCTS_FILE_PATH)) {
    fs.writeFileSync(PRODUCTS_FILE_PATH, JSON.stringify(db, null, 2), 'utf8');
} else {
    try {
        db = JSON.parse(fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8'));
        // Убедимся, что структуры есть, если файл был пуст или некорректен
        if (!db.products) db.products = [];
        if (!db.categories) db.categories = [];
    } catch (e) {
        console.error('Ошибка чтения или парсинга products.json, создаем новый:', e);
        fs.writeFileSync(PRODUCTS_FILE_PATH, JSON.stringify(db, null, 2), 'utf8');
    }
}

// Хранилища для состояний пользователей и корзин
const userCarts = {}; // { chatId: [{ id, productId, name, quantity, price, type }] }
const userStates = {}; // { chatId: { action: 'awaiting_...', data: {...} } }

console.log('"One Mart" boti ishga tushirildi...');

// ================================================================= //
// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
// ================================================================= //

/**
 * Читает заказы из файла orders.json. Если файл не существует или пуст, возвращает пустой массив.
 * @returns {Array} Массив объектов заказов.
 */
const readOrders = () => {
    if (!fs.existsSync(ORDERS_FILE_PATH)) {
        return [];
    }
    try {
        const fileContent = fs.readFileSync(ORDERS_FILE_PATH, 'utf8');
        return fileContent ? JSON.parse(fileContent) : [];
    } catch (e) {
        console.error('Ошибка чтения orders.json:', e);
        return [];
    }
};

/**
 * Записывает массив заказов в файл orders.json.
 * @param {Array} orders - Массив объектов заказов для записи.
 */
const writeOrders = (orders) => {
    fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify(orders, null, 2), 'utf8');
};

/**
 * Возвращает текстовое представление статуса заказа на узбекском.
 * @param {string} status - Кодовое название статуса (e.g., 'new', 'assembling').
 * @returns {string} Текстовое описание статуса.
 */
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

/**
 * Находит продукт по его ID.
 * @param {number} productId - ID продукта.
 * @returns {object|undefined} Объект продукта или undefined, если не найден.
 */
const findProductById = (productId) => db.products.find(p => p.id === productId);

/**
 * Находит категорию по ее ID.
 * @param {string} categoryId - ID категории.
 * @returns {object|undefined} Объект категории или undefined, если не найдена.
 */
const findCategoryById = (categoryId) => db.categories.find(c => c.id === categoryId);

/**
 * Сохраняет текущее состояние объекта db (товары и категории) в файл PRODUCTS_FILE_PATH.
 */
function saveDb() {
    fs.writeFileSync(PRODUCTS_FILE_PATH, JSON.stringify(db, null, 2), 'utf8');
    // Обновляем db из файла, чтобы быть уверенными в консистентности
    db = JSON.parse(fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8'));
}

/**
 * Сохраняет новый заказ в файл orders.json.
 * @param {number} chatId - ID чата пользователя.
 * @param {Array} cart - Массив товаров в корзине.
 * @param {object} state - Объект состояния пользователя с информацией о заказе.
 * @returns {object} Объект с новым ID и номером заказа.
 */
function saveOrderToJson(chatId, cart, state) {
    const orders = readOrders();
    const lastOrder = orders.length > 0 ? orders[orders.length - 1] : null;
    const newOrderNumber = lastOrder && lastOrder.order_number ? lastOrder.order_number + 1 : 1001; // Начинаем с 1001
    const newOrderId = Date.now(); // Уникальный ID на основе timestamp

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
        status: 'new', // Начальный статус заказа
        comment: state.comment || null
    };

    orders.push(newOrder);
    writeOrders(orders);
    return { newOrderId, newOrderNumber };
}

/**
 * Форматирует цену для отображения.
 * @param {number} price - Цена.
 * @returns {string} Отформатированная цена с валютой.
 */
const formatPrice = (price) => `${price.toLocaleString('uz-UZ')} so'm`;

// ================================================================= //
// --- ФУНКЦИИ ОТОБРАЖЕНИЯ (КЛИЕНТ) ---
// ================================================================= //

/**
 * Показывает корзину пользователя.
 * @param {number} chatId - ID чата пользователя.
 * @param {number|null} messageId - ID сообщения для редактирования, если есть.
 */
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
        const product = findProductById(item.productId); // Продукт для получения цены
        const itemPrice = product ? product.price : 0; // Используем базовую цену продукта

        let itemTotal;
        if (item.type === 'by_amount') { // Если продукт добавлен по сумме
            itemTotal = item.price; // item.price уже содержит сумму, которую указал пользователь
            messageText += `▪️ ${item.name} = ${formatPrice(itemTotal)}\n`;
            cartKeyboard.push([
                { text: `▪️ ${item.name}`, callback_data: 'ignore' },
                { text: '❌', callback_data: `cart_del_${item.id}` }
            ]);
        } else { // Обычный продукт с количеством
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

    if (messageId) {
        bot.editMessageText(messageText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: cartKeyboard } }).catch(() => { });
    } else {
        bot.sendMessage(chatId, messageText, { reply_markup: { inline_keyboard: cartKeyboard } });
    }
}

/**
 * Показывает список категорий.
 * @param {number} chatId - ID чата пользователя.
 * @param {number|null} messageId - ID сообщения для редактирования, если есть.
 */
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

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: categoryButtons } }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: categoryButtons } });
    }
}

/**
 * Показывает список продуктов в выбранной категории.
 * @param {number} chatId - ID чата пользователя.
 * @param {string} categoryId - ID категории.
 * @param {number|null} messageId - ID сообщения для редактирования, если есть.
 */
function showProductsByCategory(chatId, categoryId, messageId = null) {
    const productsInCategory = db.products.filter(p => p.category === categoryId);
    const backButton = [[{ text: '⬅️ Kategoriyalarga qaytish', callback_data: 'back_to_categories' }]];

    if (productsInCategory.length === 0) {
        const text = 'Bu kategoriyada hozircha mahsulotlar yo\'q.';
        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: backButton } }).catch(() => { });
        } else {
            bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: backButton } });
        }
        return;
    }

    const productButtons = productsInCategory.map(product => {
        let priceText = '';
        if (product.pricing_model === 'by_amount') {
            priceText = ' - har qanday summaga';
        } else if (product.price > 0) {
            priceText = ` - ${formatPrice(product.price)}`;
        } else if (product.price_per_kg > 0) { // Если вдруг есть цена за кг, хотя мы используем 'by_amount'
            priceText = ` - ${formatPrice(product.price_per_kg)}/kg`;
        }

        return [{ text: `${product.name}${priceText}`, callback_data: `product_${product.id}` }];
    });

    productButtons.push(backButton[0]);
    const text = 'Mahsulotni tanlang:';

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: productButtons } }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: productButtons } });
    }
}

/**
 * Генерирует клавиатуру для выбора количества продукта.
 * @param {object} product - Объект продукта.
 * @param {number} quantity - Текущее выбранное количество.
 * @returns {object} Объект `reply_markup` для инлайн-клавиатуры.
 */
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

/**
 * Показывает селектор количества для продукта.
 * @param {number} chatId - ID чата пользователя.
 * @param {object} product - Объект продукта.
 * @param {number} quantity - Начальное количество.
 * @param {number|null} messageId - ID сообщения для редактирования, если есть.
 */
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


/**
 * Обновляет селектор количества для продукта (редактирует существующее сообщение).
 * @param {object} query - Объект callback_query.
 * @param {object} product - Объект продукта.
 * @param {number} quantity - Новое количество.
 */
function updateQuantitySelector(query, product, quantity) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    let caption = `*${product.name}*\nNarxi: ${formatPrice(product.price)}`;
    if (product.description) {
        caption += `\n\n_${product.description}_`;
    }
    const replyMarkup = getQuantityKeyboard(product, quantity);
    
    // Для сообщений с фото используем editMessageCaption, для текстовых - editMessageText
    if (query.message.photo) {
        bot.editMessageCaption(caption, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: replyMarkup }).catch(() => { });
    } else {
        bot.editMessageText(caption, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: replyMarkup }).catch(() => { });
    }
}

// ================================================================= //
// --- ФУНКЦИИ ОТОБРАЖЕНИЯ (АДМИН-ПАНЕЛЬ) ---
// ================================================================= //

/**
 * Показывает список заказов определенного статуса в админ-панели.
 * @param {number} chatId - ID чата админа.
 * @param {string} status - Статус заказов для отображения.
 * @param {string} emptyMessage - Сообщение, если заказов с таким статусом нет.
 */
function showOrdersByStatus(chatId, status, emptyMessage) {
    const orders = readOrders().filter(o => o.status === status).reverse(); // Свежие в начале
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

/**
 * Показывает главное меню управления продуктами в админ-панели.
 * @param {number} chatId - ID чата админа.
 * @param {number|null} messageId - ID сообщения для редактирования.
 */
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

/**
 * Показывает главное меню управления категориями в админ-панели.
 * @param {number} chatId - ID чата админа.
 * @param {number|null} messageId - ID сообщения для редактирования.
 */
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

/**
 * Показывает список продуктов для выбора для редактирования или удаления.
 * @param {number} chatId - ID чата админа.
 * @param {string} actionPrefix - Префикс для callback_data (e.g., 'admin_edit_product_select_', 'admin_delete_product_select_').
 * @param {number|null} messageId - ID сообщения для редактирования.
 */
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

/**
 * Показывает список категорий для выбора для редактирования или удаления.
 * @param {number} chatId - ID чата админа.
 * @param {string} actionPrefix - Префикс для callback_data (e.g., 'admin_edit_category_select_', 'admin_delete_category_select_').
 * @param {number|null} messageId - ID сообщения для редактирования.
 */
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


// ================================================================= //
// --- ОБРАБОТЧИКИ КОМАНД И КНОПОК ---
// ================================================================= //

/**
 * Обработчик команды /start или кнопки "Янгилаш" для обычных пользователей и админа.
 */
function handleStartCommand(msg) {
    const chatId = msg.chat.id;
    userCarts[chatId] = []; // Очищаем корзину при старте
    userStates[chatId] = {}; // Очищаем состояние

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
        const welcomeText = `Assalomu alaykum, "One Mart" do'koniga xush kelibsiz!\n\n` +
            `ℹ️ **Botdan foydalanish bo'yicha qo'llanma:**\n\n` +
            `1. **Katalog:** "🛍️ Mahsulotlar katalogi" tugmasi orqali mahsulotlarni ko'rib chiqing.\n` +
            `2. **Savat:** Mahsulotlarni savatga qo'shing va "🛒 Savat" tugmasi orqali tekshiring.\n` +
            `3. **Izoh:** Savatda "✍️ Izoh qoldirish" tugmasi orqali buyurtmangizga qo'shimcha ma'lumot yozishingiz mumkin.\n` +
            `4. **Status:** Buyurtma berganingizdan so'ng, uning holatini /status buyrug'i orqali tekshirishingiz mumkin.\n\n` +
            `🚚 **Yetkazib berish:** Buyurtmalar har kuni soat 19:00 gacha qabul qilinadi va 19:30 dan keyin yetkazib beriladi. 19:00 dan keyin qilingan buyurtmalar ertasi kuni yetkaziladi.`;

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

// Обработчик кнопки "Поддержка"
bot.onText(/📞 Yordam/, (msg) => {
    const supportText = `Qo'llab-quvvatlash xizmati:\n\n` +
        `Telefon: ${SUPPORT_PHONE}\n` +
        `Telegram: @${SUPPORT_USERNAME}`;
    bot.sendMessage(msg.chat.id, supportText);
});

// Обработчик команды /admin
bot.onText(/\/admin/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) {
        return; // Только для админа
    }
    bot.sendMessage(ADMIN_CHAT_ID, 'Admin Panel:', {
        reply_markup: {
            keyboard: [
                [{ text: ADMIN_BTN_NEW }],
                [{ text: ADMIN_BTN_ASSEMBLING }, { text: ADMIN_BTN_COMPLETED }],
                [{ text: ADMIN_BTN_PRODUCTS }, { text: ADMIN_BTN_CATEGORIES }]
            ],
            resize_keyboard: true
        }
    });
});

// Обработчик команды /status
bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const orders = readOrders();
    const lastActiveOrder = orders.filter(o => o.customer_chat_id === chatId && !['completed', 'cancelled'].includes(o.status)).pop();

    if (lastActiveOrder) {
        const statusText = getStatusText(lastActiveOrder.status);
        const orderNumber = lastActiveOrder.order_number;
        const message = `Sizning #${orderNumber} raqamli buyurtmangiz holati: **${statusText}**`;
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, 'Sizda hozir faol buyurtmalar yo\'q.');
    }
});

// Обработчик кнопки "Каталог"
bot.onText(/🛍️ Mahsulotlar katalogi/, (msg) => {
    if (msg.chat.id.toString() === ADMIN_CHAT_ID) return; // Не показывать админу
    showCategories(msg.chat.id);
});

// Обработчик кнопки "Корзина"
bot.onText(/🛒 Savat|\/cart/, (msg) => {
    if (msg.chat.id.toString() === ADMIN_CHAT_ID) return; // Не показывать админу
    showCart(msg.chat.id);
});

// Обработчики кнопок админ-панели (верхний уровень)
bot.onText(new RegExp(ADMIN_BTN_NEW), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    showOrdersByStatus(ADMIN_CHAT_ID, 'new', 'Yangi buyurtmalar yo\'q.');
});

bot.onText(new RegExp(ADMIN_BTN_ASSEMBLING), (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    const orders = readOrders().filter(o => ['assembling', 'ready', 'delivering'].includes(o.status)).reverse(); // Показываем активные
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

// ================================================================= //
// --- ОБРАБОТЧИКИ ДЛЯ ВВОДА ПОЛЬЗОВАТЕЛЯ (ТЕКСТ, КОНТАКТ, ЛОКАЦИЯ) ---
// ================================================================= //

// Обработка отправки контакта
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
        // Если контакт отправлен не в контексте заказа, просто подтверждаем
        bot.sendMessage(chatId, `Telefon raqamingiz qabul qilindi: ${msg.contact.phone_number}`);
    }
});

// Обработка отправки локации
bot.on('location', (msg) => {
    const chatId = msg.chat.id;
    const userLocation = msg.location;

    if (userStates[chatId] && userStates[chatId].action === 'awaiting_location') {
        const distanceMeters = geolib.getDistance(SHOP_COORDINATES, userLocation);
        const distanceKm = distanceMeters / 1000;

        if (distanceKm > MAX_DELIVERY_RADIUS_KM) {
            bot.sendMessage(chatId, `Kechirasiz, biz ${MAX_DELIVERY_RADIUS_KM} km radiusdan tashqariga yetkazib bera olmaymiz. Sizning masofangiz: ${distanceKm.toFixed(2)} km.`, {
                reply_markup: { remove_keyboard: true } // Убираем клавиатуру с запросом локации
            });
            delete userStates[chatId]; // Сбрасываем состояние заказа
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

        let deliveryCost = DELIVERY_PRICE;
        if (subtotal >= FREE_DELIVERY_THRESHOLD) {
            deliveryCost = 0;
        }
       
        const total = subtotal + deliveryCost;

        userStates[chatId] = {
            ...userStates[chatId],
            location: userLocation,
            deliveryCost: deliveryCost,
            total: total,
            action: 'confirming_order' // Переводим в состояние ожидания подтверждения
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
            confirmationMessage += `\nIzoh: ${state.comment}\n`;
        }

        confirmationMessage += `\nMahsulotlar: ${formatPrice(subtotal)}\n`;
        confirmationMessage += `Yetkazib berish: ${deliveryCost > 0 ? formatPrice(deliveryCost) : 'Bepul'}\n\n`;
        confirmationMessage += `Jami: ${formatPrice(total)}`;

        bot.sendMessage(chatId, confirmationMessage, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Tasdiqlash", callback_data: 'confirm_order' }],
                    [{ text: "❌ Bekor qilish", callback_data: 'cancel_order' }]
                ]
            }
        });
    } else {
        // Если локация отправлена не в контексте заказа, просто подтверждаем
        bot.sendMessage(chatId, "Manzilingiz qabul qilindi.");
    }
});

// Основной обработчик текстовых сообщений (для ввода данных в состояниях)
bot.on('message', async (msg) => {
    // Игнорируем команды и кнопки, которые уже обрабатываются onText
    if (!msg.text || msg.text.startsWith('/')) { return; }
    
    const standardReplies = [
        "🛍️ Mahsulotlar katalogi", "🛒 Savat", "📞 Yordam", "🔄 Yangilash",
        ADMIN_BTN_NEW, ADMIN_BTN_ASSEMBLING, ADMIN_BTN_COMPLETED, ADMIN_BTN_PRODUCTS, ADMIN_BTN_CATEGORIES
    ];

    if (standardReplies.includes(msg.text)) {
        return;
    }

    const chatId = msg.chat.id;
    const state = userStates[chatId];

    // Обработка команды /cancel
    if (msg.text.toLowerCase() === '/cancel') {
        if (state) {
            delete userStates[chatId];
            bot.sendMessage(chatId, "Amal bekor qilindi.");
        }
        return;
    }

    if (!state || !state.action) return; // Нет активного состояния, игнорируем сообщение

    // ================== ОБРАБОТКА КЛИЕНТСКИХ ВВОДОВ ==================
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

        if (!userCarts[chatId]) {
            userCarts[chatId] = [];
        }

        // Добавляем в корзину с учетом, что это "по сумме"
        const cartItemId = `${product.id}_${Date.now()}`; // Уникальный ID для элемента корзины
        userCarts[chatId].push({
            id: cartItemId,
            productId: product.id,
            name: product.name, // Название продукта
            price: amount,       // Сумма, которую ввел пользователь
            type: 'by_amount'    // Тип продукта: по сумме
        });

        bot.sendMessage(chatId, `✅ ${product.name} (${formatPrice(amount)}) savatga qo'shildi!`);
        delete userStates[chatId]; // Сбрасываем состояние
        showCategories(chatId); // Возвращаемся в каталог
        return;
    }

    if (state.action === 'awaiting_comment') {
        userStates[chatId] = { ...userStates[chatId], comment: msg.text, action: null }; // Сохраняем комментарий и сбрасываем action
        bot.sendMessage(chatId, "Izohingiz qabul qilindi!");
        showCart(chatId); // Показываем обновленную корзину
        return;
    }

    // ================== ОБРАБОТКА АДМИНСКИХ ВВОДОВ ==================

    // --- Добавление/Редактирование продукта ---
    if (state.action && (state.action.startsWith('admin_add_product_') || state.action.startsWith('admin_edit_product_'))) {
        const step = state.action.split('_').pop();
        const product = state.data; // Текущий редактируемый/создаваемый продукт

        switch (step) {
            case 'name':
                product.name = msg.text;
                userStates[chatId].action = state.action.replace('name', 'description');
                bot.sendMessage(chatId, 'Mahsulot tavsifini kiriting (ixtiyoriy, o\'tkazib yuborish uchun "-" kiriting):');
                break;
            case 'description':
                product.description = msg.text === '-' ? '' : msg.text;
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
                product.pricing_model = (price === 0) ? 'by_amount' : 'fixed'; // Определяем модель ценообразования
                userStates[chatId].action = state.action.replace('price', 'photo');
                bot.sendMessage(chatId, 'Mahsulot rasmini yuboring (ixtiyoriy, o\'tkazib yuborish uchun "-" kiriting yoki mavjud rasmni o\'zgartirmaslik uchun "/skip" yozing):');
                break;
            case 'photo':
                if (msg.photo && msg.photo.length > 0) {
                    product.photo_url = msg.photo[msg.photo.length - 1].file_id; // Берем самую большую версию
                } else if (msg.text === '-') {
                    product.photo_url = '';
                } else if (msg.text === '/skip' && product.photo_url) {
                    // Ничего не делаем, оставляем старое фото
                } else {
                    bot.sendMessage(chatId, 'Noto\'g\'ri format. Iltimos, rasm yuboring yoki "-" kiriting:');
                    return;
                }
                userStates[chatId].action = state.action.replace('photo', 'category');
                // Показываем список категорий для выбора
                const categoryButtons = db.categories.map(cat => ([{ text: cat.name, callback_data: `admin_select_category_for_product_${cat.id}` }]));
                if (db.categories.length === 0) {
                    bot.sendMessage(chatId, 'Avval kategoriya qo\'shishingiz kerak! Amal bekor qilindi.', {
                        reply_markup: {
                            inline_keyboard: [[{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_back_to_main' }]]
                        }
                    });
                    delete userStates[chatId];
                    return;
                }
                bot.sendMessage(chatId, 'Mahsulot uchun kategoriyani tanlang:', { reply_markup: { inline_keyboard: categoryButtons } });
                break;
            case 'category':
                // Этот шаг обрабатывается через callback_query `admin_select_category_for_product_`
                // Поэтому, если мы дошли сюда, значит что-то пошло не так
                bot.sendMessage(chatId, 'Kategoriya tanlashda xatolik yuz berdi. Qaytadan urinib ko\'ring.');
                break;
        }
        userStates[chatId].data = product; // Сохраняем обновленные данные продукта
        return;
    }

    // --- Добавление/Редактирование категории ---
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
        } else { // Редактирование
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
        delete userStates[chatId]; // Сбрасываем состояние
        showAdminCategoriesMenu(chatId);
        return;
    }
});


// ================================================================= //
// --- ОБРАБОТЧИКИ CALLBACK-КНОПОК (ИНЛАЙН КЛАВИАТУРА) ---
// ================================================================= //

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data === 'ignore') {
        return bot.answerCallbackQuery(query.id);
    }
    
    // Сброс состояния для /cancel
    if (data === 'cancel_action') {
        if (userStates[chatId]) {
            delete userStates[chatId];
            bot.editMessageText('Amal bekor qilindi.', { chat_id: chatId, message_id: messageId }).catch(() => { });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    // ================== АДМИН-ПАНЕЛЬ: ЗАКАЗЫ ==================
    if (data.startsWith('admin_view_order_')) {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        const orderId = parseInt(data.split('_').pop(), 10);
        const order = readOrders().find(o => o.order_id === orderId);

        if (!order) {
            bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi!', show_alert: true });
            return;
        }

        let details = `--- Buyurtma #${order.order_number} ---\n`;
        details += `Sana: ${new Date(order.date).toLocaleString('ru-RU')}\n`;
        details += `Mijoz raqami: ${order.customer_phone}\n`;
        details += `Holat: **${getStatusText(order.status)}**\n\n`;

        if (order.comment) {
            details += `Izoh: _${order.comment}_\n\n`;
        }

        details += `Mahsulotlar:\n`;
        order.cart.forEach(item => {
            const product = findProductById(item.productId);
            if (item.type === 'by_amount') {
                details += `- ${item.name} = ${formatPrice(item.price)}\n`;
            } else {
                details += `- ${item.name} x ${item.quantity} dona = ${formatPrice((product ? product.price : 0) * item.quantity)}\n`;
            }
        });

        details += `\nMahsulotlar jami: ${formatPrice(order.total - order.delivery_cost)}\n`;
        details += `Yetkazib berish: ${order.delivery_cost > 0 ? formatPrice(order.delivery_cost) : 'Bepul'}\n`;
        details += `Jami: ${formatPrice(order.total)}\n`;

        const { latitude, longitude } = order.location;
        details += `\n📍 Manzil: [Google Maps](http://maps.google.com/maps?q=${latitude},${longitude})\n`;

        const statusButtons = [];
        if (order.status === 'new') {
            statusButtons.push({ text: '🛠 Yig\'ishni boshlash', callback_data: `admin_set_status_assembling_${order.order_id}` });
            statusButtons.push({ text: '❌ Bekor qilish', callback_data: `admin_set_status_cancelled_${order.order_id}` });
        }
        if (order.status === 'assembling') {
            statusButtons.push({ text: '✅ Tayyor', callback_data: `admin_set_status_ready_${order.order_id}` });
        }
        if (order.status === 'ready') {
            statusButtons.push({ text: '🚚 Yetkazib berish', callback_data: `admin_set_status_delivering_${order.order_id}` });
        }
        if (order.status === 'delivering') {
            statusButtons.push({ text: '🏁 Yetkazib berildi', callback_data: `admin_set_status_completed_${order.order_id}` });
        }

        bot.sendMessage(chatId, details, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [statusButtons]
            }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('admin_set_status_')) {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const newStatus = parts[3]; // admin_set_status_assembling_123 -> assembling
        const orderId = parseInt(parts.pop(), 10);

        const allOrders = readOrders();
        const orderIndex = allOrders.findIndex(o => o.order_id === orderId);

        if (orderIndex === -1) {
            bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi!', show_alert: true });
            return;
        }

        allOrders[orderIndex].status = newStatus;
        writeOrders(allOrders);
        const updatedOrder = allOrders[orderIndex];

        bot.answerCallbackQuery(query.id, { text: `Holat "${getStatusText(newStatus)}" ga o'zgartirildi.` });
        bot.deleteMessage(chatId, messageId).catch(()=>{});

        // Уведомляем клиента об изменении статуса
        const customerMessage = `Hurmatli mijoz, sizning #${updatedOrder.order_number} raqamli buyurtmangiz holati o'zgardi.\n\nYangi holat: **${getStatusText(newStatus)}**`;
        bot.sendMessage(updatedOrder.customer_chat_id, customerMessage, { parse_mode: 'Markdown' }).catch(err => {
            console.error(`Could not send message to client ${updatedOrder.customer_chat_id}: ${err}`);
        });
        
        return;
    }
    
    // ================== АДМИН-ПАНЕЛЬ: НАВИГАЦИЯ ==================
    if (data === 'admin_back_to_main') {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        bot.deleteMessage(chatId, messageId).catch(()=>{});
        bot.sendMessage(chatId, "Boshqaruv paneli:", {
             reply_markup: {
                keyboard: [
                    [{ text: ADMIN_BTN_NEW }],
                    [{ text: ADMIN_BTN_ASSEMBLING }, { text: ADMIN_BTN_COMPLETED }],
                    [{ text: ADMIN_BTN_PRODUCTS }, { text: ADMIN_BTN_CATEGORIES }]
                ],
                resize_keyboard: true
            }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }

    // ================== АДМИН-ПАНЕЛЬ: УПРАВЛЕНИЕ ПРОДУКТАМИ ==================
    if (data === 'admin_products_menu') {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        showAdminProductsMenu(chatId, messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'admin_add_product') {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        userStates[chatId] = { action: 'admin_add_product_name', data: {} }; // Инициализируем новый продукт
        bot.editMessageText('Mahsulot nomini kiriting:', { chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard: [[{text: "Bekor qilish", callback_data: "cancel_action"}]]} }).catch(() => { });
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'admin_edit_product') {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        showProductSelectionForAdmin(chatId, 'admin_edit_product_select_', messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('admin_edit_product_select_')) {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        const productId = parseInt(data.split('_').pop());
        const productToEdit = findProductById(productId);
        if (productToEdit) {
            // Копируем объект, чтобы не изменять оригинал до сохранения
            userStates[chatId] = { action: 'admin_edit_product_name', data: { ...productToEdit } };
            bot.editMessageText(`Yangi nom kiriting (joriy: "${productToEdit.name}"):`, { chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard: [[{text: "Bekor qilish", callback_data: "cancel_action"}]]} }).catch(() => { });
        } else {
             bot.answerCallbackQuery(query.id, { text: 'Mahsulot topilmadi!', show_alert: true });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data === 'admin_delete_product') {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        showProductSelectionForAdmin(chatId, 'admin_delete_product_select_', messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data.startsWith('admin_delete_product_select_')) {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        const productId = parseInt(data.split('_').pop());
        const productToDelete = findProductById(productId);
        if (productToDelete) {
             bot.editMessageText(`Haqiqatan ham "${productToDelete.name}" mahsulotini o'chirmoqchimisiz?`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Ha, o'chirish", callback_data: `admin_delete_product_confirm_${productId}` }],
                        [{ text: "❌ Yo'q, bekor qilish", callback_data: 'admin_products_menu' }]
                    ]
                }
            }).catch(() => {});
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Mahsulot topilmadi!', show_alert: true });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data.startsWith('admin_delete_product_confirm_')) {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        const productId = parseInt(data.split('_').pop());
        const productIndex = db.products.findIndex(p => p.id === productId);
        if (productIndex !== -1) {
            const productName = db.products[productIndex].name;
            db.products.splice(productIndex, 1);
            saveDb();
            bot.editMessageText(`"${productName}" mahsuloti muvaffaqiyatli o'chirildi.`, { chat_id: chatId, message_id: messageId }).catch(() => {});
            bot.answerCallbackQuery(query.id, { text: 'Mahsulot o\'chirildi!' });
            showAdminProductsMenu(chatId);
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Mahsulot topilmadi!', show_alert: true });
        }
        return;
    }
    
    if (data.startsWith('admin_select_category_for_product_')) {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        const state = userStates[chatId];
        if (!state || !(state.action === 'admin_add_product_category' || state.action === 'admin_edit_product_category')) {
             bot.answerCallbackQuery(query.id, { text: 'Xatolik: noto\'g\'ri holat!', show_alert: true });
             return;
        }

        const categoryId = data.split('_').pop();
        const productData = state.data;
        productData.category = categoryId;
        
        const isEditing = state.action.includes('edit');

        if (isEditing) {
            const productIndex = db.products.findIndex(p => p.id === productData.id);
            if (productIndex !== -1) {
                db.products[productIndex] = productData;
                bot.editMessageText(`✅ Mahsulot "${productData.name}" muvaffaqiyatli tahrirlandi!`, {chat_id: chatId, message_id: messageId}).catch(()=>{});
            } else {
                 bot.editMessageText(`❌ Xatolik: Tahrirlash uchun mahsulot topilmadi.`, {chat_id: chatId, message_id: messageId}).catch(()=>{});
            }
        } else {
            productData.id = Date.now(); // Generate unique ID for new product
            db.products.push(productData);
            bot.editMessageText(`✅ Yangi mahsulot "${productData.name}" muvaffaqiyatli qo'shildi!`, {chat_id: chatId, message_id: messageId}).catch(()=>{});
        }
        
        saveDb();
        delete userStates[chatId];
        bot.answerCallbackQuery(query.id);
        showAdminProductsMenu(chatId);
        return;
    }

    // ================== АДМИН-ПАНЕЛЬ: УПРАВЛЕНИЕ КАТЕГОРИЯМИ ==================
    if (data === 'admin_categories_menu') {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        showAdminCategoriesMenu(chatId, messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data === 'admin_add_category') {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        userStates[chatId] = { action: 'admin_add_category_name', data: {} };
        bot.editMessageText('Yangi kategoriya nomini kiriting:', { chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard: [[{text: "Bekor qilish", callback_data: "cancel_action"}]]} }).catch(() => { });
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data === 'admin_edit_category') {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        showCategorySelectionForAdmin(chatId, 'admin_edit_category_select_', messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('admin_edit_category_select_')) {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        const categoryId = data.split('_').pop();
        const categoryToEdit = findCategoryById(categoryId);
        if (categoryToEdit) {
            userStates[chatId] = { action: 'admin_edit_category_name', data: { categoryId: categoryId } };
            bot.editMessageText(`Yangi nom kiriting (joriy: "${categoryToEdit.name}"):`, { chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard: [[{text: "Bekor qilish", callback_data: "cancel_action"}]]} }).catch(() => {});
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Kategoriya topilmadi!', show_alert: true });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'admin_delete_category') {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        showCategorySelectionForAdmin(chatId, 'admin_delete_category_select_', messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data.startsWith('admin_delete_category_select_')) {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        const categoryId = data.split('_').pop();
        const categoryToDelete = findCategoryById(categoryId);
        const productsInCategory = db.products.filter(p => p.category === categoryId);

        if (productsInCategory.length > 0) {
            bot.answerCallbackQuery(query.id, { text: `Ushbu kategoriyani o'chirish mumkin emas, unda ${productsInCategory.length}ta mahsulot mavjud!`, show_alert: true });
            return;
        }

        if (categoryToDelete) {
             bot.editMessageText(`Haqiqatan ham "${categoryToDelete.name}" kategoriyasini o'chirmoqchimisiz?`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Ha, o'chirish", callback_data: `admin_delete_category_confirm_${categoryId}` }],
                        [{ text: "❌ Yo'q, bekor qilish", callback_data: 'admin_categories_menu' }]
                    ]
                }
            }).catch(() => {});
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Kategoriya topilmadi!', show_alert: true });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data.startsWith('admin_delete_category_confirm_')) {
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id);
        const categoryId = data.split('_').pop();
        const categoryIndex = db.categories.findIndex(c => c.id === categoryId);
        if (categoryIndex !== -1) {
            const categoryName = db.categories[categoryIndex].name;
            db.categories.splice(categoryIndex, 1);
            saveDb();
            bot.editMessageText(`"${categoryName}" kategoriyasi muvaffaqiyatli o'chirildi.`, { chat_id: chatId, message_id: messageId }).catch(() => {});
            bot.answerCallbackQuery(query.id, { text: 'Kategoriya o\'chirildi!' });
            showAdminCategoriesMenu(chatId);
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Kategoriya topilmadi!', show_alert: true });
        }
        return;
    }


    // ================== КЛИЕНТСКАЯ ЧАСТЬ ==================
    if (data.startsWith('category_')) {
        const categoryId = data.substring(9);
        showProductsByCategory(chatId, categoryId, messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'back_to_categories') {
        showCategories(chatId, messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('product_')) {
        const productId = parseInt(data.substring(8));
        const product = findProductById(productId);
        if (product) {
            if (product.pricing_model === 'by_amount') {
                userStates[chatId] = { action: 'awaiting_product_amount', productId: productId };
                bot.deleteMessage(chatId, messageId).catch(() => {});
                bot.sendMessage(chatId, `"${product.name}" uchun kerakli summani kiriting:`);
            } else {
                showQuantitySelector(chatId, product, 1, messageId);
            }
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('increase_') || data.startsWith('decrease_')) {
        const parts = data.split('_');
        const action = parts[0];
        const productId = parseInt(parts[1]);
        let quantity = parseInt(parts[2]);
        const product = findProductById(productId);

        if (product) {
            if (action === 'increase') {
                quantity++;
            } else if (action === 'decrease' && quantity > 1) {
                quantity--;
            }
            updateQuantitySelector(query, product, quantity);
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('addToCart_')) {
        const parts = data.split('_');
        const productId = parseInt(parts[1]);
        const quantity = parseInt(parts[2]);
        const product = findProductById(productId);

        if (product) {
            if (!userCarts[chatId]) userCarts[chatId] = [];

            const existingItemIndex = userCarts[chatId].findIndex(item => item.productId === productId);
            if (existingItemIndex > -1) {
                userCarts[chatId][existingItemIndex].quantity += quantity;
            } else {
                userCarts[chatId].push({
                    id: `${productId}_${Date.now()}`,
                    productId: productId,
                    name: product.name,
                    quantity: quantity,
                    price: product.price, // Store price per item for fixed price
                    type: 'fixed'
                });
            }

            bot.answerCallbackQuery(query.id, { text: `${product.name} savatga qo'shildi!` });
            bot.deleteMessage(chatId, messageId).catch(()=>{});
            showCategories(chatId);
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Mahsulot topilmadi!', show_alert: true });
        }
        return;
    }
    
    // ================== УПРАВЛЕНИЕ КОРЗИНОЙ ==================
    if (data.startsWith('cart_')) {
        const parts = data.split('_');
        const action = parts[1];
        const itemId = data.substring(data.indexOf('_', 5) + 1);

        const cart = userCarts[chatId] || [];
        const itemIndex = cart.findIndex(item => item.id === itemId);

        if (itemIndex > -1) {
             if (action === 'incr') {
                 cart[itemIndex].quantity++;
             } else if (action === 'decr') {
                 if (cart[itemIndex].quantity > 1) {
                    cart[itemIndex].quantity--;
                 } else {
                    cart.splice(itemIndex, 1); // Remove if quantity becomes 0
                 }
             } else if (action === 'del') {
                 cart.splice(itemIndex, 1);
             }
             showCart(chatId, messageId);
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'clear_cart') {
        userCarts[chatId] = [];
        showCart(chatId, messageId);
        bot.answerCallbackQuery(query.id, { text: 'Savat tozalandi!' });
        return;
    }
    
    if (data === 'leave_comment') {
        userStates[chatId] = { ...userStates[chatId], action: 'awaiting_comment' };
        bot.sendMessage(chatId, "Buyurtmangizga izoh yozing:");
        bot.answerCallbackQuery(query.id);
        return;
    }

    // ================== ОФОРМЛЕНИЕ ЗАКАЗА ==================
    if (data === 'checkout') {
        const cart = userCarts[chatId];
        if (!cart || cart.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Sizning savatingiz bo\'sh!', show_alert: true });
            return;
        }

        const subtotal = cart.reduce((sum, item) => {
             const product = findProductById(item.productId);
             if (!product) return sum;
             return sum + (item.type === 'by_amount' ? item.price : product.price * item.quantity);
        }, 0);

        if (subtotal < MIN_ORDER_AMOUNT) {
            bot.answerCallbackQuery(query.id, { text: `Minimal buyurtma summasi ${formatPrice(MIN_ORDER_AMOUNT)}`, show_alert: true });
            return;
        }
        
        userStates[chatId] = { ...userStates[chatId], action: 'awaiting_phone_for_order' };
        bot.sendMessage(chatId, "Telefon raqamingizni yuboring:", {
            reply_markup: {
                keyboard: [[{ text: '📞 Telefon raqamni yuborish', request_contact: true }]],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data === 'confirm_order') {
        const state = userStates[chatId];
        const cart = userCarts[chatId];
        if (!state || state.action !== 'confirming_order' || !cart || cart.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Buyurtma berishda xatolik yuz berdi. Qaytadan urinib ko\'ring.', show_alert: true });
            return;
        }

        const { newOrderId, newOrderNumber } = saveOrderToJson(chatId, cart, state);
        
        // Notify admin
        let adminNotification = `🆕 Yangi buyurtma! #${newOrderNumber}\n\n`;
        cart.forEach(item => {
             const product = findProductById(item.productId);
             if (item.type === 'by_amount') {
                adminNotification += `- ${item.name} = ${formatPrice(item.price)}\n`;
             } else {
                adminNotification += `- ${item.name} x ${item.quantity} dona\n`;
             }
        });
        if (state.comment) {
            adminNotification += `\n*Izoh:* ${state.comment}\n`;
        }
        adminNotification += `\n*Jami:* ${formatPrice(state.total)}\n`;
        adminNotification += `*Telefon:* ${state.phone}`;
        
        bot.sendMessage(ADMIN_CHAT_ID, adminNotification, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: 'Batafsil ko\'rish', callback_data: `admin_view_order_${newOrderId}` }]]
            }
        });

        // Clear user state and cart
        delete userCarts[chatId];
        delete userStates[chatId];

        // Confirm to user
        bot.editMessageText(`Rahmat! Sizning #${newOrderNumber} raqamli buyurtmangiz qabul qilindi. Tez orada operatorimiz siz bilan bog'lanadi.`, {
            chat_id: chatId, message_id: messageId, reply_markup: null
        }).catch(() => {});
        
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data === 'cancel_order') {
        delete userStates[chatId];
        bot.editMessageText('Buyurtma bekor qilindi.', {
            chat_id: chatId, message_id: messageId
        }).catch(()=>{});
        bot.answerCallbackQuery(query.id);
        return;
    }

    bot.answerCallbackQuery(query.id);
});

bot.on('polling_error', (error) => {
  console.log(`Polling error: ${error.code} - ${error.message}`);
});
