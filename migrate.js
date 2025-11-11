const fs = require('fs');
const { Pool } = require('pg');

// --- НАСТРОЙКИ ---
// Берем URL из переменных окружения, как и в bot.js
const DATABASE_URL = process.env.DATABASE_URL;
const PRODUCTS_FILE_PATH = 'products.json';
// -----------------

if (!DATABASE_URL) {
    console.error('Ошибка: Переменная окружения DATABASE_URL не найдена!');
    console.log('Пожалуйста, убедитесь, что вы добавили ее во вкладке "Environment" на Render.');
    process.exit(1);
}

const db = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const migrateData = async () => {
    let client;
    try {
        console.log('Подключаемся к базе данных...');
        client = await db.connect();

        console.log('Чтение файла products.json...');
        if (!fs.existsSync(PRODUCTS_FILE_PATH)) {
            console.error(`Ошибка: Файл ${PRODUCTS_FILE_PATH} не найден.`);
            return;
        }
        const fileContent = fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8');
        const data = JSON.parse(fileContent);

        const categories = data.categories || [];
        const products = data.products || [];

        // --- 1. Миграция Категорий ---
        console.log(`Найдено ${categories.length} категорий. Начинаем миграцию...`);
        const categoryMap = {}; // { "drinks": 1, "non": 2 }
        
        for (const category of categories) {
            try {
                const { rows: [newCategory] } = await client.query(
                    'INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = $1 RETURNING id, name',
                    [category.name]
                );
                categoryMap[category.id] = newCategory.id;
                console.log(`- Категория "${newCategory.name}" добавлена/обновлена с ID ${newCategory.id}`);
            } catch (catErr) {
                console.error(`Ошибка при добавлении категории "${category.name}":`, catErr.message);
            }
        }
        console.log('Миграция категорий завершена.');

        // --- 2. Миграция Продуктов ---
        console.log(`Найдено ${products.length} продуктов. Начинаем миграцию...`);
        for (const product of products) {
            const categoryId = categoryMap[product.category] || null;
            if (!categoryId) {
                console.warn(`! Продукт "${product.name_uz}" пропущен: не найдена категория с ID "${product.category}"`);
                continue;
            }

            try {
                await client.query(
                    `INSERT INTO products (name_uz, name_ru, price, pricing_model, description, photo_url, category_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        product.name_uz,
                        product.name_ru,
                        product.price,
                        product.pricing_model,
                        product.description,
                        product.photo_url,
                        categoryId
                    ]
                );
            } catch (prodErr) {
                console.error(`Ошибка при добавлении продукта "${product.name_uz}":`, prodErr.message);
            }
        }
        console.log('Миграция продуктов завершена.');

        console.log('\n✅ ✅ ✅ МИГРАЦИЯ УСПЕШНО ЗАВЕРШЕНА! ✅ ✅ ✅');
        console.log('Все товары и категории скопированы в базу данных.');
        
    } catch (e) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА:', e);
    } finally {
        if (client) {
            client.release();
        }
        await db.end();
        console.log('Отключились от базы данных.');
    }
};

migrateData();
