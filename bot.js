const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const geolib = require('geolib');
const http = require("http");
const levenshtein = require('fast-levenshtein');
const { Pool } = require('pg');

// ================================================================= //
// --- НАСТРОЙКИ ---
// ================================================================= //
const TOKEN = process.env.TOKEN || '7976277994:AAFOmpAk4pdD85U9kvhmI-lLhtziCyfGTUY';

// --- Список Супер-Админов (которые могут управлять магазинами) ---
// Вставьте сюда свои ID
const SUPER_ADMIN_IDS = ['5309814540', '7790411205']; 

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '-1002943886944';
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+998914906787';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || 'Mukhammadyusuf6787';

// --- Константы кнопок ---
const ADMIN_BTN_NEW = '🆕 Yangi buyurtmalar';
const ADMIN_BTN_ASSEMBLING = '🛠 Yig\'ilayotganlar';
const ADMIN_BTN_COMPLETED = '✅ Bajarilganlar';
const ADMIN_BTN_PRODUCTS = '📦 Mahsulotlar';
const ADMIN_BTN_CATEGORIES = '🗂 Kategoriyalar';
const ADMIN_BTN_STORES = '🏪 Do\'konlar';

// --- Константы кнопок Магазинов ---
const ADMIN_BTN_ADD_STORE = '➕ Yangi do\'kon qo\'shish';
const ADMIN_BTN_EDIT_STORE = '✏️ Do\'konni tahrirlash';
const ADMIN_BTN_DELETE_STORE = '❌ Do\'konni o\'chirish';
const ADMIN_BTN_BACK_TO_STORES_MENU = '⬅️ Do\'konlar menyusiga qaytish';

// --- Константы кнопок Продуктов ---
const ADMIN_BTN_ADD_PRODUCT = '➕ Yangi mahsulot qo\'shish';
const ADMIN_BTN_EDIT_PRODUCT = '✏️ Mahsulotni tahrirlash';
const ADMIN_BTN_DELETE_PRODUCT = '❌ Mahsulotni o\'chirish';
const ADMIN_BTN_BACK_TO_ADMIN_MENU = '⬅️ Admin panelga qaytish';
const ADMIN_BTN_BACK_TO_PRODUCTS_MENU = '⬅️ Mahsulotlar menyusiga qaytish';
const ADMIN_BTN_BACK_TO_CATEGORIES_MENU = '⬅️ Kategoriyalar menyusiga qaytish';

// --- Правила доставки ---
const DELIVERY_PRICE_TIER_1 = 8000;
const DELIVERY_PRICE_TIER_2 = 5000;
const DELIVERY_THRESHOLD_1 = 50000;
const DELIVERY_THRESHOLD_2 = 100000;
const BASE_DELIVERY_RADIUS_KM = 2.5;
const PRICE_PER_EXTRA_KM = 4000;
const MAX_DELIVERY_RADIUS_KM = 10;

// --- Координаты магазина (Больше не используются, но оставим для совместимости) ---
const SHOP_COORDINATES = { latitude: 40.764535, longitude: 72.282204 };

// ================================================================= //
// --- ИНИЦИАЛИЗАЦИЯ БОТА И БАЗЫ ДАННЫХ ---
// ================================================================= //
const bot = new TelegramBot(TOKEN, { polling: true });

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const userCarts = {};
const userStates = {};

// Глобальное хранилище для кэширования владельцев
let adminCache = {
    superAdmins: SUPER_ADMIN_IDS,
    storeOwners: {} 
};

async function initializeDatabase() {
    const client = await db.connect();
    try {
        // --- Создание таблиц (если еще не существуют) ---
        await client.query(`
            CREATE TABLE IF NOT EXISTS owners (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT NOT NULL UNIQUE,
                name VARCHAR(255),
                phone VARCHAR(20)
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS stores (
                id SERIAL PRIMARY KEY,
                owner_id INTEGER REFERENCES owners(id),
                name VARCHAR(255) NOT NULL,
                address TEXT,
                latitude FLOAT NOT NULL,
                longitude FLOAT NOT NULL
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
                category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
                name_uz VARCHAR(255) NOT NULL,
                name_ru VARCHAR(255),
                price INTEGER NOT NULL,
                pricing_model VARCHAR(20) DEFAULT 'standard',
                description TEXT,
                photo_url VARCHAR(512)
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                order_id SERIAL PRIMARY KEY,
                store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
                order_number INTEGER NOT NULL,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                customer_chat_id BIGINT NOT NULL,
                customer_phone VARCHAR(20),
                cart JSONB,
                delivery_details JSONB,
                total INTEGER NOT NULL,
                latitude FLOAT,
                longitude FLOAT,
                status VARCHAR(20) DEFAULT 'new',
                comment TEXT
            );
        `);
        
        console.log('Database tables checked/created successfully.');

        // --- Кэширование владельцев магазинов ---
        await refreshAdminCache();
        
    } catch (e) {
        console.error('ERROR initializing database tables:', e);
    } finally {
        client.release();
    }
}

console.log('"One Mart" boti ishga tushirildi...');

// ================================================================= //
// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
// ================================================================= //

async function refreshAdminCache() {
    try {
        const { rows: owners } = await db.query('SELECT o.chat_id, s.id AS store_id FROM owners o JOIN stores s ON s.owner_id = o.id');
        const newOwnerCache = {};
        owners.forEach(owner => {
            newOwnerCache[owner.chat_id.toString()] = owner.store_id;
        });
        adminCache.storeOwners = newOwnerCache;
        console.log('Admin cache refreshed.');
    } catch (e) {
        console.error("Error refreshing admin cache:", e);
    }
}

function isSuperAdmin(chatId) {
    return adminCache.superAdmins.includes(chatId.toString());
}

function isStoreOwner(chatId) {
    return adminCache.storeOwners[chatId.toString()] !== undefined;
}

function isAdmin(chatId) {
    return isSuperAdmin(chatId) || isStoreOwner(chatId);
}

function getStoreIdForAdmin(chatId) {
    return adminCache.storeOwners[chatId.toString()];
}

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

const findProductById = async (productId) => {
    const { rows: [product] } = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
    return product;
};

const findCategoryById = async (categoryId) => {
    const { rows: [category] } = await db.query('SELECT * FROM categories WHERE id = $1', [categoryId]);
    return category;
};

const formatPrice = (price) => `${price.toLocaleString('uz-UZ')} so'm`;

// ================================================================= //
// --- ФУНКЦИИ ОТОБРАЖЕНИЯ (КЛИЕНТ) ---
// ================================================================= //

async function showCart(chatId, messageId = null) {
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

    const productIds = cart.map(item => item.productId);
    if (productIds.length === 0) {
         if (messageId) {
            bot.editMessageText('Savatda xatolik.', { chat_id: chatId, message_id: messageId }).catch(() => { });
         } else {
            bot.sendMessage(chatId, 'Savatda xatolik.');
         }
         return;
    }

    const { rows: products } = await db.query('SELECT id, price FROM products WHERE id = ANY($1)', [productIds]);
    
    const priceMap = {};
    products.forEach(p => { priceMap[p.id] = p.price; });

    cart.forEach(item => {
        const itemPrice = priceMap[item.productId] || 0;
        const displayName = item.name; 

        let itemTotal;
        if (item.type === 'by_amount') {
            itemTotal = item.price;
            messageText += `▪️ ${displayName} = ${formatPrice(itemTotal)}\n`;
            cartKeyboard.push([
                { text: `▪️ ${displayName}`, callback_data: 'ignore' },
                { text: '❌', callback_data: `cart_del_${item.id}` }
            ]);
        } else {
            itemTotal = itemPrice * item.quantity;
            messageText += `▪️ ${displayName} x ${item.quantity} dona = ${formatPrice(itemTotal)}\n`;
            cartKeyboard.push([
                { text: `▪️ ${displayName}`, callback_data: `ignore_${item.id}` },
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

async function showCategories(chatId, messageId = null) {
    const { rows: categories } = await db.query('SELECT * FROM categories ORDER BY name ASC');

    if (!categories || categories.length === 0) {
        const text = 'Hozircha kategoriyalar yo\'q.';
        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId }).catch(() => { });
        } else {
            bot.sendMessage(chatId, text);
        }
        return;
    }

    const categoryButtons = categories.map(category => ([{ text: category.name, callback_data: 'category_' + category.id }]));
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

async function sendProductList(chatId, messageId, productList, title, backCallback) {
    const backButton = [[{ text: '⬅️ Orqaga', callback_data: backCallback }]];

    if (productList.length === 0) {
        const text = 'Afsuski, hech narsa topilmadi.';
        const options = { chat_id: chatId, reply_markup: { inline_keyboard: backButton } };
        if (messageId) {
            options.message_id = messageId;
            bot.editMessageText(text, options).catch(() => {});
        } else {
            bot.sendMessage(chatId, text, options);
        }
        return;
    }

    const productButtons = productList.map(product => {
        const displayName = product.name_uz || product.name; 
        let priceText = '';
        if (product.pricing_model === 'by_amount') {
            priceText = ' - istalgan summaga';
        } else if (product.price > 0) {
            priceText = ` - ${formatPrice(product.price)}`;
        }
        return [{ text: `${displayName}${priceText}`, callback_data: `product_${product.id}` }];
    });

    productButtons.push(backButton[0]);
    const options = {
        chat_id: chatId,
        reply_markup: { inline_keyboard: productButtons }
    };

    if (messageId) {
        options.message_id = messageId;
        bot.editMessageText(title, options).catch(() => {});
    } else {
        bot.sendMessage(chatId, title, options);
    }
}


async function showProductsByCategory(chatId, categoryId, messageId = null) {
    // TODO: Фильтр по store_id из userStates
    const storeId = 1; 

    const { rows: productsInCategory } = await db.query(
        'SELECT * FROM products WHERE category_id = $1 AND store_id = $2 ORDER BY name_uz ASC', 
        [categoryId, storeId]
    );
    const { rows: [category] } = await db.query('SELECT name FROM categories WHERE id = $1', [categoryId]);
    
    const title = category ? `Kategoriya: ${category.name}` : 'Mahsulotlar:';
    sendProductList(chatId, messageId, productsInCategory, title, 'back_to_categories');
}

function getQuantityKeyboard(product, quantity) {
    const displayName = product.name_uz || product.name;
    return {
        inline_keyboard: [
            [{ text: '➖', callback_data: `decrease_${product.id}_${quantity}` },
            { text: `${quantity}`, callback_data: 'ignore' },
            { text: '➕', callback_data: `increase_${product.id}_${quantity}` }],
            [{ text: `Savatga qo'shish (${formatPrice(product.price * quantity)})`, callback_data: `addToCart_${product.id}_${quantity}` }],
            [{ text: '⬅️ Mahsulotlarga qaytish', callback_data: 'category_' + product.category_id }]
        ]
    };
}

async function showQuantitySelector(chatId, product, quantity, messageId = null) {
    const displayName = product.name_uz || product.name;
    let caption = `*${displayName}*\nNarxi: ${formatPrice(product.price)}`;
    if (product.description) {
        caption += `\n\n_${product.description}_`;
    }
    const replyMarkup = getQuantityKeyboard(product, quantity);

    if (messageId) {
        bot.deleteMessage(chatId, messageId).catch(()=>{});
    }

    if (product.photo_url && product.photo_url.startsWith('http')) {
        bot.sendPhoto(chatId, product.photo_url, { caption: caption, parse_mode: 'Markdown', reply_markup: replyMarkup }).catch(() => {
            bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup });
        });
    } else if (product.photo_url) { 
        bot.sendPhoto(chatId, product.photo_url, { caption: caption, parse_mode: 'Markdown', reply_markup: replyMarkup }).catch(() => {
            bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup });
        });
    } else {
        bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup });
    }
}


async function updateQuantitySelector(query, product, quantity) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const displayName = product.name_uz || product.name;

    let caption = `*${displayName}*\nNarxi: ${formatPrice(product.price)}`;
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

async function showUserOrders(chatId, messageId = null) {
    const { rows: userOrders } = await db.query('SELECT * FROM orders WHERE customer_chat_id = $1 ORDER BY date DESC', [chatId]);

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

async function showOrdersByStatus(chatId, status, emptyMessage) {
    const storeId = getStoreIdForAdmin(chatId);
    let orders;
    
    if (isSuperAdmin(chatId)) {
        const { rows } = await db.query('SELECT * FROM orders WHERE status = $1 ORDER BY date DESC', [status]);
        orders = rows;
    } else if (storeId) {
        const { rows } = await db.query('SELECT * FROM orders WHERE status = $1 AND store_id = $2 ORDER BY date DESC', [status, storeId]);
        orders = rows;
    } else {
        orders = [];
    }
    
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

// --- НОВЫЕ ФУНКЦИИ АДМИН-ПАНЕЛИ (МАГАЗИНЫ) ---

function showAdminStoresMenu(chatId, messageId = null) {
    const text = 'Do\'konlarni boshqarish:';
    const keyboard = {
        inline_keyboard: [
            [{ text: ADMIN_BTN_ADD_STORE, callback_data: 'admin_add_store' }],
            [{ text: ADMIN_BTN_EDIT_STORE, callback_data: 'admin_edit_store' }],
            [{ text: ADMIN_BTN_DELETE_STORE, callback_data: 'admin_delete_store' }],
            [{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_back_to_main' }]
        ]
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, { reply_markup: keyboard });
    }
}

async function showStoreSelectionForAdmin(chatId, actionPrefix, messageId = null) {
    const { rows: stores } = await db.query('SELECT * FROM stores ORDER BY name ASC');

    if (stores.length === 0) {
        const text = 'Hozircha do\'konlar yo\'q.';
        const keyboard = { inline_keyboard: [[{ text: ADMIN_BTN_BACK_TO_STORES_MENU, callback_data: 'admin_stores_menu' }]] };
        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => { });
        } else {
            bot.sendMessage(chatId, text, { reply_markup: keyboard });
        }
        return;
    }

    const storeButtons = stores.map(s => ([{ text: s.name, callback_data: `${actionPrefix}${s.id}` }]));
    storeButtons.push([{ text: ADMIN_BTN_BACK_TO_STORES_MENU, callback_data: 'admin_stores_menu' }]);

    const text = 'Do\'konni tanlang:';
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: storeButtons } }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: storeButtons } });
    }
}

// === ИСПРАВЛЕННАЯ ФУНКЦИЯ: теперь проверяет messageId ===
async function showOwnerSelectionForAdmin(chatId, messageId = null) {
    const { rows: owners } = await db.query('SELECT * FROM owners ORDER BY name ASC');
    let text = 'Do\'kon egasini tanlang:\n\n';
    
    if (owners.length === 0) {
        text += 'Hozircha egalar yo\'q. Avval egani qo\'shing.';
        if (messageId) {
             bot.editMessageText(text, { chat_id: chatId, message_id: messageId }).catch(() => {});
        } else {
             bot.sendMessage(chatId, text);
        }
        return;
    }

    const ownerButtons = owners.map(o => ([{ text: `${o.name} (${o.chat_id})`, callback_data: `admin_select_owner_${o.id}` }]));
    ownerButtons.push([{ text: '⬅️ Orqaga', callback_data: 'admin_stores_menu' }]);
    
    const options = {
        chat_id: chatId,
        reply_markup: { inline_keyboard: ownerButtons }
    };

    if (messageId) {
        options.message_id = messageId;
        bot.editMessageText(text, options).catch(() => {});
    } else {
        bot.sendMessage(chatId, text, options);
    }
}
// === КОНЕЦ ИСПРАВЛЕНИЯ ===

async function showProductSelectionForAdmin(chatId, actionPrefix, page = 1, messageId = null) {
    const limit = 10;
    const offset = (page - 1) * limit;

    const storeId = getStoreIdForAdmin(chatId);
    let totalProducts, products;

    if (isSuperAdmin(chatId)) {
        const { rows: [countResult] } = await db.query('SELECT COUNT(*) FROM products');
        totalProducts = parseInt(countResult.count, 10);
        const { rows } = await db.query('SELECT * FROM products ORDER BY name_uz ASC LIMIT $1 OFFSET $2', [limit, offset]);
        products = rows;
    } else if (storeId) {
        const { rows: [countResult] } = await db.query('SELECT COUNT(*) FROM products WHERE store_id = $1', [storeId]);
        totalProducts = parseInt(countResult.count, 10);
        const { rows } = await db.query('SELECT * FROM products WHERE store_id = $1 ORDER BY name_uz ASC LIMIT $2 OFFSET $3', [storeId, limit, offset]);
        products = rows;
    } else {
        products = [];
        totalProducts = 0;
    }
    
    const totalPages = Math.ceil(totalProducts / limit);

    if (products.length === 0 && page === 1) {
        const text = 'Hozircha mahsulotlar yo\'q.';
        const keyboard = { inline_keyboard: [[{ text: ADMIN_BTN_BACK_TO_PRODUCTS_MENU, callback_data: 'admin_products_menu' }]] };
        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => { });
        } else {
            bot.sendMessage(chatId, text, { reply_markup: keyboard });
        }
        return;
    }

    const productButtons = products.map(p => {
       const displayName = p.name_uz || p.name;
       const priceText = p.pricing_model === 'by_amount' ? 'summa' : formatPrice(p.price);
       return [{ text: `${displayName} (${priceText})`, callback_data: `${actionPrefix}${p.id}` }];
    });

    const paginationRow = [];
    if (page > 1) {
        paginationRow.push({ text: '⬅️ Oldingi', callback_data: `admin_products_page_${actionPrefix}_${page - 1}` });
    }
    if (page < totalPages) {
        paginationRow.push({ text: 'Keyingi ➡️', callback_data: `admin_products_page_${actionPrefix}_${page + 1}` });
    }

    if (paginationRow.length > 0) {
        productButtons.push(paginationRow);
    }
    productButtons.push([{ text: ADMIN_BTN_BACK_TO_PRODUCTS_MENU, callback_data: 'admin_products_menu' }]);

    const text = `Mahsulotni tanlang (Sahifa ${page}/${totalPages}):`;
    const options = {
        chat_id: chatId,
        reply_markup: { inline_keyboard: productButtons }
    };
    
    if (messageId) {
        options.message_id = messageId;
        bot.editMessageText(text, options).catch(err => console.error("Edit message error (pagination):", err));
    } else {
        bot.sendMessage(chatId, text, options).catch(err => console.error("Send message error (pagination):", err));
    }
}

async function showCategorySelectionForAdmin(chatId, actionPrefix, messageId = null) {
    const { rows: categories } = await db.query('SELECT * FROM categories ORDER BY name ASC');

    if (categories.length === 0) {
        const text = 'Hozircha kategoriyalar yo\'q.';
        const keyboard = { inline_keyboard: [[{ text: ADMIN_BTN_BACK_TO_CATEGORIES_MENU, callback_data: 'admin_categories_menu' }]] };
        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => { });
        } else {
            bot.sendMessage(chatId, text, { reply_markup: keyboard });
        }
        return;
    }

    const categoryButtons = categories.map(c => ([{ text: c.name, callback_data: `${actionPrefix}${c.id}` }]));
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

async function handleStartCommand(msg) {
    const chatId = msg.chat.id;
    userStates[chatId] = {};

    if (isSuperAdmin(chatId)) {
        bot.sendMessage(chatId, 'Salom, Super Admin! Boshqaruv paneli:', {
            reply_markup: {
                keyboard: [
                    [{ text: ADMIN_BTN_NEW }],
                    [{ text: ADMIN_BTN_ASSEMBLING }, { text: ADMIN_BTN_COMPLETED }],
                    [{ text: ADMIN_BTN_PRODUCTS }, { text: ADMIN_BTN_CATEGORIES }],
                    [{ text: ADMIN_BTN_STORES }]
                ],
                resize_keyboard: true
            }
        });
    } else if (isStoreOwner(chatId)) {
        const storeId = getStoreIdForAdmin(chatId);
        const { rows: [store] } = await db.query('SELECT name FROM stores WHERE id = $1', [storeId]);
        bot.sendMessage(chatId, `Salom, "${store.name}" do'koni egasi! Boshqaruv paneli:`, {
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
            `4. *Qidirish:* "🔍 Qidirish" tugmasi orqali mahsulotlarni nomi bo'yicha tez toping.\n` +
            `5. *Status:* Buyurtma holatini /status buyrug'i orqali tekshirishingiz mumkin.\n\n` +
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
                    [{ text: "📋 Mening buyurtmalarim" }, { text: "🔍 Qidirish" }],
                    [{ text: "📞 Yordam" }, { text: "🔄 Yangilash" }]
                ],
                resize_keyboard: true
            }
        });
    }
}

bot.onText(/\/start/, (msg) => {
    userCarts[msg.chat.id] = [];
    handleStartCommand(msg);
});

bot.onText(/🔄 Yangilash/, handleStartCommand);

bot.onText(/📞 Yordam/, (msg) => {
    const supportText = `Qo'llab-quvvatlash xizmati:\n\n` +
        `Telefon: ${SUPPORT_PHONE}\n` +
        `Telegram: @${SUPPORT_USERNAME}`;
    bot.sendMessage(msg.chat.id, supportText);
});

bot.onText(/\/admin/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    handleStartCommand(msg);
});

bot.onText(/\/db_check/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return;

    bot.sendMessage(chatId, '🔬 Проверяю базу данных...');

    try {
        const { rows: [categoryCount] } = await db.query('SELECT COUNT(*) FROM categories');
        const { rows: [productCount] } = await db.query('SELECT COUNT(*) FROM products');
        const { rows: [storeCount] } = await db.query('SELECT COUNT(*) FROM stores');
        const { rows: [ownerCount] } = await db.query('SELECT COUNT(*) FROM owners');

        let report = `--- 📈 Отчет по Базе Данных ---\n\n`;
        report += `Категорий в \`categories\`: ${categoryCount.count}\n`;
        report += `Товаров в \`products\`: ${productCount.count}\n`;
        report += `Магазинов в \`stores\`: ${storeCount.count}\n`;
        report += `Владельцев в \`owners\`: ${ownerCount.count}\n\n`;

        if (categoryCount.count > 0 && productCount.count > 0 && storeCount.count > 0) {
            report += `✅ База данных выглядит корректно.`;
        } else {
            report += `❌ ВНИМАНИЕ: Одна из таблиц пуста! Возможно, миграция не удалась.`;
        }

        bot.sendMessage(chatId, report);

    } catch (e) {
        bot.sendMessage(chatId, `❌ Ошибка подключения к БД: ${e.message}`);
    }
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const { rows: [lastActiveOrder] } = await db.query(
        "SELECT * FROM orders WHERE customer_chat_id = $1 AND status NOT IN ('completed', 'cancelled') ORDER BY date DESC LIMIT 1",
        [chatId]
    );

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
    if (isAdmin(msg.chat.id)) return;
    showCategories(msg.chat.id);
});

bot.onText(/🛒 Savat|\/cart/, (msg) => {
    if (isAdmin(msg.chat.id)) return;
    showCart(msg.chat.id);
});

bot.onText(/📋 Mening buyurtmalarim|\/buyurtmalarim/, (msg) => {
    if (isAdmin(msg.chat.id)) return;
    showUserOrders(msg.chat.id);
});

bot.onText(/🔍 Qidirish/, (msg) => {
    if (isAdmin(msg.chat.id)) return;
    userStates[msg.chat.id] = { action: 'awaiting_search_query' };
    bot.sendMessage(msg.chat.id, "Qidirmoqchi bo'lgan mahsulot nomini kiriting (kamida 2 ta harf):");
});

bot.onText(new RegExp(ADMIN_BTN_NEW), (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    showOrdersByStatus(msg.chat.id, 'new', 'Yangi buyurtmalar yo\'q.');
});

bot.onText(new RegExp(ADMIN_BTN_ASSEMBLING), async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const storeId = getStoreIdForAdmin(msg.chat.id);
    let orders;

    if(isSuperAdmin(msg.chat.id)) {
        const { rows } = await db.query("SELECT * FROM orders WHERE status IN ('assembling', 'ready', 'delivering') ORDER BY date DESC");
        orders = rows;
    } else if (storeId) {
        const { rows } = await db.query("SELECT * FROM orders WHERE status IN ('assembling', 'ready', 'delivering') AND store_id = $1 ORDER BY date DESC", [storeId]);
        orders = rows;
    } else {
        orders = [];
    }

    if (orders.length === 0) {
        bot.sendMessage(msg.chat.id, 'Yig\'ilayotgan buyurtmalar yo\'q.');
        return;
    }
    const orderButtons = orders.map(order => {
        const orderDate = new Date(order.date).toLocaleTimeString('ru-RU');
        return [{ text: `#${order.order_number} (${getStatusText(order.status)}) - ${orderDate}`, callback_data: `admin_view_order_${order.order_id}` }];
    });
    bot.sendMessage(msg.chat.id, `Faol buyurtmalar:`, { reply_markup: { inline_keyboard: orderButtons } });
});

bot.onText(new RegExp(ADMIN_BTN_COMPLETED), (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    showOrdersByStatus(msg.chat.id, 'completed', 'Bajarilgan buyurtmalar yo\'q.');
});

bot.onText(new RegExp(ADMIN_BTN_PRODUCTS), (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    showAdminProductsMenu(msg.chat.id);
});

bot.onText(new RegExp(ADMIN_BTN_CATEGORIES), (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    showAdminCategoriesMenu(msg.chat.id);
});

// --- НОВЫЙ ОБРАБОТЧИК ---
bot.onText(new RegExp(ADMIN_BTN_STORES), (msg) => {
    if (!isSuperAdmin(msg.chat.id)) return; // Только Супер Админ
    showAdminStoresMenu(msg.chat.id);
});

bot.on('contact', (msg) => {
    const chatId = msg.chat.id;

    // Сценарий для админа: добавление владельца магазина
    if (isAdmin(chatId) && userStates[chatId] && userStates[chatId].action === 'admin_add_store_owner_phone') {
        userStates[chatId].data.phone = msg.contact.phone_number;
        userStates[chatId].action = 'admin_add_store_owner_chatid';
        bot.sendMessage(chatId, 'Telefon raqam qabul qilindi. Endi shu egasining (owner) Telegram CHAT ID raqamini kiriting (masalan, 5309814540).');
        return;
    }
    
    // Сценарий для клиента: оформление заказа
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

bot.on('location', async (msg) => {
    const chatId = msg.chat.id;
    const userLocation = msg.location;

    // Сценарий для админа: добавление магазина
    if (isAdmin(chatId) && userStates[chatId] && userStates[chatId].action === 'admin_add_store_location') {
        userStates[chatId].data.latitude = userLocation.latitude;
        userStates[chatId].data.longitude = userLocation.longitude;
        userStates[chatId].action = 'admin_add_store_owner';
        
        bot.sendMessage(chatId, 'Manzil qabul qilindi.', { reply_markup: { remove_keyboard: true } });
        await showOwnerSelectionForAdmin(chatId, null);
        return;
    }

    // Сценарий для клиента: оформление заказа
    if (userStates[chatId] && userStates[chatId].action === 'awaiting_location') {
        // TODO: В будущем - брать координаты из userStates[chatId].store_id
        const { rows: [store] } = await db.query('SELECT * FROM stores WHERE id = 1'); // ВРЕМЕННО: используем магазин #1
        const storeCoordinates = { latitude: store.latitude, longitude: store.longitude };

        const distanceMeters = geolib.getDistance(storeCoordinates, userLocation);
        const distanceKm = distanceMeters / 1000;

        if (distanceKm > MAX_DELIVERY_RADIUS_KM) {
            bot.sendMessage(chatId, `Kechirasiz, biz ${MAX_DELIVERY_RADIUS_KM} km radiusdan tashqariga yetkazib bera olmaymiz. Sizning masofangiz: ${distanceKm.toFixed(2)} km.`, {
                reply_markup: { remove_keyboard: true }
            });
            delete userStates[chatId];
            handleStartCommand(msg);
            return;
        }

        const cart = userCarts[chatId];
        if (!cart || cart.length === 0) {
            bot.sendMessage(chatId, "Savatingiz bo'sh, iltimos, qaytadan boshlang.");
            delete userStates[chatId];
            return;
        }

        const productIds = cart.map(item => item.productId);
        const { rows: products } = await db.query('SELECT id, price FROM products WHERE id = ANY($1)', [productIds]);
        const priceMap = {};
        products.forEach(p => { priceMap[p.id] = p.price; });

        const subtotal = cart.reduce((sum, item) => {
            const itemPrice = priceMap[item.productId] || 0;
            return sum + (item.type === 'by_amount' ? item.price : itemPrice * item.quantity);
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
            store_id: store.id, // <-- Сохраняем ID магазина для заказа
            action: 'confirming_order'
        };

        bot.sendMessage(chatId, 'Manzil qabul qilindi. Buyurtma tekshirilmoqda...', {
            reply_markup: {
                remove_keyboard: true
            }
        }).then(sentMsg => {
            bot.deleteMessage(chatId, sentMsg.message_id);

            let confirmationMessage = "Iltimos, buyurtmangizni tasdiqlang:\n\n";
            cart.forEach(item => {
                const displayName = item.name;
                if (item.type === 'by_amount') {
                    confirmationMessage += `▪️ ${displayName} = ${formatPrice(item.price)}\n`;
                } else {
                    const product = products.find(p => p.id === item.productId);
                    const itemPrice = product ? product.price : 0;
                    confirmationMessage += `▪️ ${displayName} x ${item.quantity} dona = ${formatPrice(itemPrice * item.quantity)}\n`;
                }
            });
            
            const state = userStates[chatId];
            if (state && state.comment) {
                confirmationMessage += `\n*Izoh:* ${state.comment}\n`;
            }
            confirmationMessage += `\n*Do'kon:* ${store.name}\n`;
            confirmationMessage += `*Mahsulotlar:* ${formatPrice(subtotal)}\n`;
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
        });

    } else {
        bot.sendMessage(chatId, "Manzilingiz qabul qilindi.");
    }
});

bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) { return; }
    
    const standardReplies = [
        "🛍️ Mahsulotlar", "🛒 Savat", "📞 Yordam", "🔄 Yangilash", "📋 Mening buyurtmalarim", "🔍 Qidirish",
        ADMIN_BTN_NEW, ADMIN_BTN_ASSEMBLING, ADMIN_BTN_COMPLETED, ADMIN_BTN_PRODUCTS, ADMIN_BTN_CATEGORIES, ADMIN_BTN_STORES
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
        const { rows: [product] } = await db.query('SELECT * FROM products WHERE id = $1', [state.productId]);
        if (!product) {
            bot.sendMessage(chatId, "Xatolik: mahsulot topilmadi.");
            delete userStates[chatId];
            return;
        }
        if (!userCarts[chatId]) userCarts[chatId] = [];
        const displayName = product.name_uz || product.name;
        const cartItemId = `${product.id}_${Date.now()}`;
        userCarts[chatId].push({ id: cartItemId, productId: product.id, name: displayName, price: amount, type: 'by_amount' });
        bot.sendMessage(chatId, `✅ ${displayName} (${formatPrice(amount)}) savatga qo'shildi!`);
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

    if (state.action === 'awaiting_search_query') {
        const query = msg.text.toLowerCase().trim();
        delete userStates[chatId];

        if (query.length < 2) {
            bot.sendMessage(chatId, "Qidiruv so'zi kamida 2 ta harfdan iborat bo'lishi kerak.");
            return;
        }
        
        const threshold = 2;
        // TODO: В будущем - фильтровать по store_id
        const storeId = 1; // ВРЕМЕННО
        const { rows: allProducts } = await db.query('SELECT * FROM products WHERE store_id = $1', [storeId]);

        const results = allProducts.filter(p => {
            const nameUz = (p.name_uz || "").toLowerCase();
            const nameRu = (p.name_ru || "").toLowerCase();

            if (nameUz.includes(query) || nameRu.includes(query)) {
                return true;
            }
            if (levenshtein.get(nameUz, query) <= threshold || levenshtein.get(nameRu, query) <= threshold) {
                return true;
            }
            return false;
        });
        
        sendProductList(chatId, null, results, `Qidiruv natijalari: "${msg.text}"`, 'back_to_categories');
        return;
    }

    // --- ОБРАБОТЧИКИ ДЛЯ АДМИНА ---
    if (isAdmin(chatId)) {
        
        // --- Админ: Добавление/Редактирование Продукта ---
        if (state.action && (state.action.startsWith('admin_add_product_') || state.action.startsWith('admin_edit_product_'))) {
            const step = state.action.split('_').pop();
            const product = state.data;

            switch (step) {
                case 'name':
                    product.name_uz = msg.text;
                    userStates[chatId].action = state.action.replace('name', 'name_ru');
                    bot.sendMessage(chatId, 'Endi mahsulotning ruscha nomini kiriting (kirillitsada):');
                    break;
                case 'name_ru':
                    product.name_ru = msg.text;
                    userStates[chatId].action = state.action.replace('name_ru', 'description');
                    bot.sendMessage(chatId, 'Mahsulot tavsifini kiriting (ixtiyoriy, o\'tkazib yuborish uchun "-" kiriting):');
                    break;
                case 'description':
                    product.description = msg.text === '-' ? null : msg.text;
                    userStates[chatId].action = state.action.replace('description', 'price');
                    bot.sendMessage(chatId, 'Mahsulot narxini kiriting (faqat raqam, masalan, 15000).\nAgar mahsulot narxi foydalanuvchi tomonidan kiritiladigan bo\'lsa, "0" raqamini kiriting:');
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
                    
                    const { rows: categories } = await db.query('SELECT * FROM categories ORDER BY name ASC');
                    if (categories.length === 0) {
                        bot.sendMessage(chatId, 'Avval kategoriya qo\'shishingiz kerak! Amal bekor qilindi.', {
                            reply_markup: { inline_keyboard: [[{ text: ADMIN_BTN_BACK_TO_ADMIN_MENU, callback_data: 'admin_back_to_main' }]] }
                        });
                        delete userStates[chatId];
                        return;
                    }
                    const categoryButtons = categories.map(cat => ([{ text: cat.name, callback_data: `admin_select_category_for_product_${cat.id}` }]));
                    bot.sendMessage(chatId, 'Mahsulot uchun kategoriyani tanlang:', { reply_markup: { inline_keyboard: categoryButtons } });
                    break;
            }
            userStates[chatId].data = product;
            return;
        }

        // --- Админ: Добавление/Редактирование Категории ---
        if (state.action && (state.action === 'admin_add_category_name' || state.action === 'admin_edit_category_name')) {
            const categoryName = msg.text.trim();
            if (categoryName.length < 2) {
                bot.sendMessage(chatId, 'Kategoriya nomi kamida 2ta belgidan iborat bo\'lishi kerak. Qaytadan kiriting:');
                return;
            }

            const { rows: [existingCategory] } = await db.query('SELECT * FROM categories WHERE lower(name) = lower($1)', [categoryName]);
            
            const isAdding = state.action === 'admin_add_category_name';
            
            if (isAdding) {
                if (existingCategory) {
                    bot.sendMessage(chatId, `"${categoryName}" nomli kategoriya allaqachon mavjud. Boshqa nom tanlang:`);
                    return;
                }
                await db.query('INSERT INTO categories (name) VALUES ($1)', [categoryName]);
                bot.sendMessage(chatId, `Kategoriya "${categoryName}" muvaffaqiyatli qo'shildi.`);
            } else {
                const categoryIdToEdit = state.data.categoryId;
                if (existingCategory && existingCategory.id !== categoryIdToEdit) {
                    bot.sendMessage(chatId, `"${categoryName}" nomli kategoriya allaqachon mavjud. Boshqa nom tanlang:`);
                    return;
                }
                await db.query('UPDATE categories SET name = $1 WHERE id = $2', [categoryName, categoryIdToEdit]);
                bot.sendMessage(chatId, `Kategoriya "${categoryName}" muvaffaqiyatli tahrirlandi.`);
            }
            
            delete userStates[chatId];
            showAdminCategoriesMenu(chatId);
            return;
        }
        
        // --- Супер-Админ: Добавление/Редактирование Магазина ---
        if (isSuperAdmin(chatId) && state.action && state.action.startsWith('admin_add_store_')) {
            const step = state.action.split('_').pop();
            const storeData = state.data;
            
            switch (step) {
                case 'name':
                    storeData.name = msg.text;
                    userStates[chatId].action = 'admin_add_store_address';
                    bot.sendMessage(chatId, 'Do\'kon manzilini kiriting (masalan, "Yunusobod t-ni, 14-kvartal"):');
                    break;
                case 'address':
                    storeData.address = msg.text;
                    userStates[chatId].action = 'admin_add_store_location';
                    bot.sendMessage(chatId, 'Endi do\'kon geolokatsiyasini yuboring (📍 Manzilni yuborish tugmasi orqali).', {
                        reply_markup: {
                            keyboard: [[{ text: "📍 Manzilni yuborish", request_location: true }]],
                            one_time_keyboard: true,
                            resize_keyboard: true
                        }
                    });
                    break;
                case 'owner':
                    // Этот шаг обрабатывается в on('location') и callback_query
                    break;
            }
            userStates[chatId].data = storeData;
            return;
        }
        
        // --- Супер-Админ: Добавление Владельца ---
        if (isSuperAdmin(chatId) && state.action && state.action.startsWith('admin_add_store_owner_')) {
            const step = state.action.split('_').pop();
            const ownerData = state.data;
            
            switch(step) {
                case 'name':
                    ownerData.name = msg.text;
                    userStates[chatId].action = 'admin_add_store_owner_phone';
                    bot.sendMessage(chatId, `Egasining telefon raqamini yuboring (tugma orqali).`, {
                        reply_markup: {
                            keyboard: [[{ text: '📞 Telefon raqamni yuborish', request_contact: true }]],
                            one_time_keyboard: true,
                            resize_keyboard: true
                        }
                    });
                    break;
                case 'chatid':
                    const ownerChatId = msg.text.trim();
                    if (!/^\d+$/.test(ownerChatId)) {
                        bot.sendMessage(chatId, "Xato: CHAT ID faqat raqamlardan iborat bo'lishi kerak. Qaytadan kiriting:");
                        return;
                    }
                    ownerData.chat_id = ownerChatId;
                    
                    try {
                        await db.query(
                            'INSERT INTO owners (chat_id, name, phone) VALUES ($1, $2, $3)',
                            [ownerData.chat_id, ownerData.name, ownerData.phone]
                        );
                        bot.sendMessage(chatId, `✅ Yangi ega "${ownerData.name}" muvaffaqiyatli qo'shildi.`);
                        await refreshAdminCache(); // Обновляем кэш админов
                        delete userStates[chatId];
                        showAdminStoresMenu(chatId);
                    } catch (e) {
                        if (e.code === '23505') { // Ошибка unique_violation
                            bot.sendMessage(chatId, `Xatolik: Bu CHAT ID (${ownerData.chat_id}) allaqachon ro'yxatdan o'tgan.`);
                        } else {
                            console.error('Ошибка добавления владельца:', e);
                            bot.sendMessage(chatId, 'Xatolik yuz berdi.');
                        }
                        delete userStates[chatId];
                        showAdminStoresMenu(chatId);
                    }
                    break;
            }
            userStates[chatId].data = ownerData;
            return;
        }
    }
});


bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data === 'ignore') return bot.answerCallbackQuery(query.id);
    
    if (data === 'cancel_action') {
        if (userStates[chatId]) {
            delete userStates[chatId];
            bot.editMessageText('Amal bekor qilindi.', { chat_id: chatId, message_id: messageId }).catch(() => { });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('admin_view_order_')) {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        const orderId = parseInt(data.split('_').pop(), 10);
        
        const { rows: [order] } = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);

        if (!order) {
            bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi!', show_alert: true });
            return;
        }

        // Проверка, может ли админ видеть этот заказ
        const storeId = getStoreIdForAdmin(chatId);
        if (!isSuperAdmin(chatId) && order.store_id !== storeId) {
            bot.answerCallbackQuery(query.id, { text: 'Siz faqat o\'z do\'koningiz buyurtmalarini ko\'ra olasiz.', show_alert: true });
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
            if (item.type === 'by_amount') {
                details += `- ${item.name} = ${formatPrice(item.price)}\n`;
            } else {
                details += `- ${item.name} x ${item.quantity} dona\n`;
            }
        });

        const subtotal = order.total - (order.delivery_details.totalCost || 0);
        details += `\nMahsulotlar jami: ${formatPrice(subtotal)}\n`;
        if (order.delivery_details) {
            details += `Yetkazib berish (asosiy): ${formatPrice(order.delivery_details.baseCost)}\n`;
            if(order.delivery_details.distanceSurcharge > 0) {
                details += `Masofa uchun qo'shimcha (${order.delivery_details.distanceKm} km): ${formatPrice(order.delivery_details.distanceSurcharge)}\n`;
            }
        }
        details += `Jami: ${formatPrice(order.total)}\n`;

        details += `\n📍 Manzil: [Google Maps](http://googleusercontent.com/maps/google.com/0{order.latitude},${order.longitude})\n`;

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
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const newStatus = parts[3];
        const orderId = parseInt(parts.pop(), 10);
        
        const { rows: [updatedOrder] } = await db.query(
            'UPDATE orders SET status = $1 WHERE order_id = $2 RETURNING *',
            [newStatus, orderId]
        );

        if (!updatedOrder) {
            bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi!', show_alert: true });
            return;
        }

        bot.answerCallbackQuery(query.id, { text: `Holat "${getStatusText(newStatus)}" ga o'zgartirildi.` });
        bot.deleteMessage(chatId, messageId).catch(()=>{});
        const customerMessage = `Hurmatli mijoz, sizning №${updatedOrder.order_number} raqamli buyurtmangiz holati o'zgardi.\n\nYangi holat: **${getStatusText(newStatus)}**`;
        bot.sendMessage(updatedOrder.customer_chat_id, customerMessage, { parse_mode: 'Markdown' }).catch(err => {
            console.error(`Could not send message to client ${updatedOrder.customer_chat_id}: ${err}`);
        });
        return;
    }
    
    if (data === 'admin_back_to_main') {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        bot.deleteMessage(chatId, messageId).catch(()=>{});
        handleStartCommand(query.message); // Показываем правильное админ-меню
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'admin_products_menu' || data === ADMIN_BTN_BACK_TO_PRODUCTS_MENU) {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        showAdminProductsMenu(chatId, messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'admin_add_product') {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        userStates[chatId] = { action: 'admin_add_product_name', data: {} };
        bot.editMessageText('Mahsulotning o\'zbekcha nomini kiriting:', { chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard: [[{text: "Bekor qilish", callback_data: "cancel_action"}]]} }).catch(() => { });
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'admin_edit_product') {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        showProductSelectionForAdmin(chatId, 'admin_edit_product_select_', 1, messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data.startsWith('admin_products_page_')) {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        
        const parts = data.split('_');
        const page = parseInt(parts.pop(), 10);
        const actionPrefix = data.replace(`admin_products_page_`, '').replace(`_${page}`, '');

        showProductSelectionForAdmin(chatId, actionPrefix, page, messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('admin_edit_product_select_')) {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        const productId = parseInt(data.split('_').pop(), 10);
        const { rows: [productToEdit] } = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
        
        if (productToEdit) {
            userStates[chatId] = { action: 'admin_edit_product_name', data: { ...productToEdit } };
            const displayName = productToEdit.name_uz || productToEdit.name;
            bot.editMessageText(`Yangi o'zbekcha nom kiriting (joriy: "${displayName}"):`, { chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard: [[{text: "Bekor qilish", callback_data: "cancel_action"}]]} }).catch(() => { });
        } else {
             bot.answerCallbackQuery(query.id, { text: 'Mahsulot topilmadi!', show_alert: true });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data === 'admin_delete_product') {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        showProductSelectionForAdmin(chatId, 'admin_delete_product_select_', 1, messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data.startsWith('admin_delete_product_select_')) {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        const productId = parseInt(data.split('_').pop(), 10);
        const { rows: [productToDelete] } = await db.query('SELECT name_uz, name FROM products WHERE id = $1', [productId]);

        if (productToDelete) {
             const displayName = productToDelete.name_uz || productToDelete.name;
             bot.editMessageText(`Haqiqatan ham "${displayName}" mahsulotini o'chirmoqchimisiz?`, {
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
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(query.id);
        const productId = parseInt(data.split('_').pop(), 10);
        await db.query('DELETE FROM products WHERE id = $1', [productId]);
        bot.answerCallbackQuery(query.id, { text: 'Mahsulot o\'chirildi!' });
        showProductSelectionForAdmin(chatId, 'admin_delete_product_select_', 1, messageId);
        return;
    }

    // --- НОВЫЕ ОБРАБОТЧИКИ ДЛЯ "МАГАЗИНОВ" (только Супер-Админ) ---
    if (isSuperAdmin(chatId)) {
        if (data === 'admin_stores_menu' || data === ADMIN_BTN_BACK_TO_STORES_MENU) {
            showAdminStoresMenu(chatId, messageId);
            bot.answerCallbackQuery(query.id);
            return;
        }

        if (data === 'admin_add_store') {
            userStates[chatId] = { action: 'admin_add_store_name', data: {} };
            bot.editMessageText('Yangi do\'kon nomini kiriting (masalan, "One Mart - Chilonzor"):', { chat_id: chatId, message_id: messageId }).catch(() => {});
            bot.answerCallbackQuery(query.id);
            return;
        }
        
        if (data === 'admin_add_store_owner') {
            userStates[chatId] = { action: 'admin_add_store_owner_name', data: {} };
            bot.editMessageText('Yangi do\'kon egasining ismini kiriting (masalan, "Ali Valiyev"):', { chat_id: chatId, message_id: messageId }).catch(() => {});
            bot.answerCallbackQuery(query.id);
            return;
        }
        
        if (data.startsWith('admin_select_owner_')) {
            const ownerId = parseInt(data.split('_').pop(), 10);
            const state = userStates[chatId];
            if (!state || state.action !== 'admin_add_store_owner') {
                 bot.answerCallbackQuery(query.id, { text: 'Xatolik!', show_alert: true });
                 return;
            }
            const storeData = state.data;
            try {
                await db.query(
                    'INSERT INTO stores (name, address, latitude, longitude, owner_id) VALUES ($1, $2, $3, $4, $5)',
                    [storeData.name, storeData.address, storeData.latitude, storeData.longitude, ownerId]
                );
                await refreshAdminCache(); // Обновляем кэш
                bot.editMessageText(`✅ Yangi do'kon "${storeData.name}" muvaffaqiyatli qo'shildi!`, {chat_id: chatId, message_id: messageId}).catch(()=>{});
            } catch (e) {
                console.error("Do'kon qo'shishda xatolik:", e);
                bot.editMessageText(`❌ Xatolik yuz berdi.`, {chat_id: chatId, message_id: messageId}).catch(()=>{});
            }
            delete userStates[chatId];
            bot.answerCallbackQuery(query.id);
            return;
        }
        
        if (data === 'admin_edit_store') {
            showStoreSelectionForAdmin(chatId, 'admin_edit_store_select_', messageId);
            bot.answerCallbackQuery(query.id);
            return;
        }
        // TODO: Добавить логику редактирования магазина
        
        if (data === 'admin_delete_store') {
            showStoreSelectionForAdmin(chatId, 'admin_delete_store_select_', messageId);
            bot.answerCallbackQuery(query.id);
            return;
        }
        // TODO: Добавить логику удаления магазина
    }
    // --- КОНЕЦ ОБРАБОТЧИКОВ "МАГАЗИНОВ" ---

    if (data.startsWith('category_')) {
        const categoryId = parseInt(data.substring(9), 10);
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
        const productId = parseInt(data.substring(8), 10);
        const product = await findProductById(productId);
        if (product) {
            if (product.pricing_model === 'by_amount') {
                userStates[chatId] = { action: 'awaiting_product_amount', productId: productId };
                bot.deleteMessage(chatId, messageId).catch(() => {});
                const displayName = product.name_uz || product.name;
                bot.sendMessage(chatId, `"${displayName}" uchun kerakli summani kiriting:`);
            } else {
                showQuantitySelector(chatId, product, 1, messageId);
            }
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('increase_') || data.startsWith('decrease_')) {
        const parts = data.split('_');
        const productId = parseInt(parts[1], 10);
        let quantity = parseInt(parts[2], 10);
        const product = await findProductById(productId);
        if (product) {
            if (parts[0] === 'increase') quantity++;
            else if (quantity > 1) quantity--;
            updateQuantitySelector(query, product, quantity);
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('addToCart_')) {
        const parts = data.split('_');
        const productId = parseInt(parts[1], 10);
        const quantity = parseInt(parts[2], 10);
        const product = await findProductById(productId);
        
        if (product) {
            if (!userCarts[chatId]) userCarts[chatId] = [];
            const displayName = product.name_uz || product.name;
            const existingItemIndex = userCarts[chatId].findIndex(item => item.productId === productId);
            if (existingItemIndex > -1) {
                userCarts[chatId][existingItemIndex].quantity += quantity;
            } else {
                userCarts[chatId].push({ id: `${productId}_${Date.now()}`, productId: productId, name: displayName, quantity: quantity, price: product.price, type: 'standard' });
            }
            bot.answerCallbackQuery(query.id, { text: `${displayName} savatga qo'shildi!` });
            bot.deleteMessage(chatId, messageId).catch(()=>{});
            showCategories(chatId);
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Mahsulot topilmadi!', show_alert: true });
        }
        return;
    }
    
    if (data.startsWith('cart_')) {
        const parts = data.split('_');
        const action = parts[1];
        const itemId = data.substring(data.indexOf('_', 5) + 1);
        const cart = userCarts[chatId] || [];
        const itemIndex = cart.findIndex(item => item.id === itemId);
        if (itemIndex > -1) {
             if (action === 'incr') cart[itemIndex].quantity++;
             else if (action === 'decr') {
                 if (cart[itemIndex].quantity > 1) cart[itemIndex].quantity--;
                 else cart.splice(itemIndex, 1);
             } else if (action === 'del') cart.splice(itemIndex, 1);
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

    if (data === 'checkout') {
        const cart = userCarts[chatId];
        if (!cart || cart.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Sizning savatingiz bo\'sh!', show_alert: true });
            return;
        }
        userStates[chatId] = { ...userStates[chatId], action: 'awaiting_phone_for_order' };
        bot.editMessageText("Telefon raqamingizni yuborishingizni so'raymiz:", { chat_id: chatId, message_id: messageId }).catch(()=>{});
        bot.sendMessage(chatId, "Buning uchun quyidagi tugmani bosing:", {
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
        
        let adminNotification = `🆕 Yangi buyurtma! #${newOrderNumber}\n\n`;
        cart.forEach(item => {
             if (item.type === 'by_amount') adminNotification += `- ${item.name} = ${formatPrice(item.price)}\n`;
             else adminNotification += `- ${item.name} x ${item.quantity} dona\n`;
        });
        if (state.comment) adminNotification += `\n*Izoh:* ${state.comment}\n`;
        adminNotification += `\n*Jami:* ${formatPrice(state.total)}\n`;
        adminNotification += `*Telefon:* ${state.phone}`;
        
        // TODO: Отправлять админу нужного магазина, а не всем
        SUPER_ADMIN_IDS.forEach(adminId => {
            bot.sendMessage(adminId, adminNotification, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: 'Batafsil ko\'rish', callback_data: `admin_view_order_${newOrderId}` }]]
                }
            }).catch(err => console.error(`Админу (${adminId}) сообщение отправить не удалось: ${err}`));
        });

        if (GROUP_CHAT_ID) {
            const { latitude, longitude } = state.location;
            const groupNotification = adminNotification + `\n📍 Manzil: [Google Maps](http://maps.google.com/maps?q=${latitude},${longitude})`;
            bot.sendMessage(GROUP_CHAT_ID, groupNotification, {
                parse_mode: 'Markdown',
            }).catch(err => console.error(`Guruhga (${GROUP_CHAT_ID}) xabar yuborib bo'lmadi: ${err}`));
        }

        delete userCarts[chatId];
        delete userStates[chatId];

        bot.editMessageText(`Rahmat! Sizning №${newOrderNumber} raqamli buyurtmangiz qabul qilindi. Tez orada operatorimiz siz bilan bog'lanadi.`, {
            chat_id: chatId, message_id: messageId, reply_markup: null
        }).catch(() => {});
        
        handleStartCommand(query.message);

        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data === 'cancel_order') {
        delete userStates[chatId];
        bot.editMessageText('Buyurtma bekor qilindi.', { chat_id: chatId, message_id: messageId, reply_markup: null }).catch(()=>{});
        
        handleStartCommand(query.message);
        
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data === 'back_to_my_orders') {
        showUserOrders(chatId, messageId);
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data.startsWith('view_my_order_')) {
        const orderId = parseInt(data.split('_').pop(), 10);
        const { rows: [order] } = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]); // Убрали customer_chat_id для просмотра деталей

        if (!order) {
            bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi!', show_alert: true });
            return;
        }
        let details = `*Buyurtma №${order.order_number}*\n\n`;
        details += `*Sana:* ${new Date(order.date).toLocaleString('uz-UZ')}\n`;
        details += `*Holat:* ${getStatusText(order.status)}\n\n`;
        details += "*Mahsulotlar:*\n";
        order.cart.forEach(item => {
            if (item.type === 'by_amount') details += `▪️ ${item.name} - ${formatPrice(item.price)}\n`;
            else details += `▪️ ${item.name} x ${item.quantity} dona\n`;
        });
        if (order.comment) details += `\n*Izoh:* _${order.comment}_\n`;
        details += `\n*Jami:* ${formatPrice(order.total)}`;
        const keyboard = [];
        if (order.status === 'new') keyboard.push([{ text: "❌ Buyurtmani bekor qilish", callback_data: `cancel_my_order_${order.order_id}` }]);
        keyboard.push([{ text: "⬅️ Orqaga", callback_data: 'back_to_my_orders' }]);
        bot.editMessageText(details, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }).catch(() => {});
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('cancel_my_order_')) {
        const orderId = parseInt(data.split('_').pop(), 10);
        bot.editMessageText('Haqiqatan ham ushbu buyurtmani bekor qilmoqchimisiz?', {
            chat_id: chatId, message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Ha", callback_data: `confirm_cancel_my_order_${orderId}` }],
                    [{ text: "❌ Yo'q", callback_data: `view_my_order_${orderId}` }]
                ]
            }
        }).catch(() => {});
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('confirm_cancel_my_order_')) {
        const orderId = parseInt(data.split('_').pop(), 10);
        
        const { rows: [order] } = await db.query('SELECT * FROM orders WHERE order_id = $1 AND customer_chat_id = $2', [orderId, chatId]);

        if (!order) {
            bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi!', show_alert: true });
            return;
        }
        if (order.status !== 'new') {
            bot.answerCallbackQuery(query.id, { text: "Kechirasiz, buyurtmani bekor qilishning imkoni yo'q, u allaqachon qayta ishlanmoqda.", show_alert: true });
            query.data = `view_my_order_${order.order_id}`;
            bot.emit('callback_query', query);
            return;
        }

        await db.query("UPDATE orders SET status = 'cancelled' WHERE order_id = $1", [orderId]);
        
        bot.editMessageText(`Sizning №${order.order_number} raqamli buyurtmangiz bekor qilindi.`, {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: "⬅️ Barcha buyurtmalarga qaytish", callback_data: 'back_to_my_orders' }]] }
        }).catch(() => {});
        bot.answerCallbackQuery(query.id);
        
        SUPER_ADMIN_IDS.forEach(adminId => {
            bot.sendMessage(adminId, `❗️ Mijoz №${order.order_number} raqamli buyurtmani bekor qildi.`).catch(() => {});
        });
        return;
    }
    
    bot.answerCallbackQuery(query.id);
});

bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
  } else {
    console.log(`Polling error: ${error.code} - ${error.message}`);
  }
});

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is alive!");
});

initializeDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
});
