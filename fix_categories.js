const fs = require('fs');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const PRODUCTS_FILE_PATH = 'products.json';

if (!DATABASE_URL) process.exit(1);

const db = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function fixCategories() {
    const client = await db.connect();
    try {
        console.log('🔧 Начинаем восстановление категорий...');

        // 1. Читаем JSON
        const fileContent = fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8');
        const jsonData = JSON.parse(fileContent);
        const jsonCategories = jsonData.categories; // [{id: "drinks", name: "..."}, ...]
        const jsonProducts = jsonData.products;

        console.log(`📂 В файле JSON: ${jsonCategories.length} категорий, ${jsonProducts.length} товаров.`);

        // 2. Получаем категории из Базы Данных
        const { rows: dbCategories } = await client.query('SELECT * FROM categories');
        console.log(`🗄  В Базе Данных: ${dbCategories.length} категорий.`);

        // 3. Создаем карту соответствия: "Название категории" -> "ID в базе"
        // Мы используем ИМЯ категории как связующее звено
        const nameToDbId = {};
        dbCategories.forEach(cat => {
            nameToDbId[cat.name] = cat.id;
        });

        // 4. Создаем карту: "JSON ID" -> "DB ID"
        // Например: "drinks" -> 5
        const jsonIdToDbId = {};
        jsonCategories.forEach(cat => {
            const dbId = nameToDbId[cat.name];
            if (dbId) {
                jsonIdToDbId[cat.id] = dbId;
            }
        });

        console.log('🔗 Связи построены. Начинаем обновление товаров...');

        let updatedCount = 0;
        
        // 5. Проходимся по всем товарам и обновляем их в базе
        for (const prod of jsonProducts) {
            const targetCategoryId = jsonIdToDbId[prod.category]; // Получаем ID категории (число) по строковому ID из JSON

            if (targetCategoryId) {
                // Обновляем товар в базе по его имени (name_uz), устанавливая правильный category_id
                await client.query(
                    'UPDATE products SET category_id = $1 WHERE name_uz = $2',
                    [targetCategoryId, prod.name_uz]
                );
                updatedCount++;
            }
        }

        console.log(`✅ Успешно обновлено связей товаров: ${updatedCount}`);
        console.log('🎉 Категории восстановлены! Теперь товары должны появиться.');

    } catch (e) {
        console.error('❌ Ошибка:', e);
    } finally {
        client.release();
        db.end();
    }
}

fixCategories();
