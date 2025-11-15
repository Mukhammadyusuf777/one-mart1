const { Pool } = require('pg');

// Берем URL базы данных из настроек Render (или вставьте его сюда вручную для теста)
const DATABASE_URL = process.env.DATABASE_URL; 

if (!DATABASE_URL) {
    console.error('❌ Ошибка: Нет DATABASE_URL. Убедитесь, что он есть в Environment Variables.');
    process.exit(1);
}

const db = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function repairDatabase() {
    const client = await db.connect();
    try {
        console.log('🔧 Начинаем ремонт базы данных...');

        // 1. Создаем таблицы owners и stores, если их нет
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
        console.log('✅ Таблицы owners и stores проверены.');

        // 2. Добавляем колонку store_id в products, если её нет
        try {
            await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL');
            console.log('✅ Колонка store_id добавлена в products.');
        } catch (e) {
            console.log('ℹ️ Колонка store_id уже существует или ошибка:', e.message);
        }

        // 3. Добавляем колонку store_id в orders, если её нет
        try {
            await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL');
            console.log('✅ Колонка store_id добавлена в orders.');
        } catch (e) {
            console.log('ℹ️ Колонка store_id уже существует в orders.');
        }

        // 4. Создаем Главного Владельца и Главный Магазин
        // ВАЖНО: Замените ID на ваш, если нужно
        const MY_CHAT_ID = '5309814540'; 
        
        const { rows: [owner] } = await client.query(`
            INSERT INTO owners (chat_id, name) VALUES ($1, 'Super Admin')
            ON CONFLICT (chat_id) DO UPDATE SET name = 'Super Admin'
            RETURNING id
        `, [MY_CHAT_ID]);
        
        const { rows: [store] } = await client.query(`
            INSERT INTO stores (id, owner_id, name, address, latitude, longitude)
            VALUES (1, $1, 'One Mart (Asosiy)', 'Bosh ofis', 40.0, 72.0)
            ON CONFLICT (id) DO UPDATE SET name = 'One Mart (Asosiy)'
            RETURNING id
        `, [owner.id]);
        
        console.log(`✅ Магазин №1 готов. ID: ${store.id}`);

        // 5. Привязываем ВСЕ товары к Магазину №1
        const { rowCount } = await client.query('UPDATE products SET store_id = 1 WHERE store_id IS NULL');
        console.log(`✅ Обновлено товаров: ${rowCount}. Теперь они привязаны к магазину №1.`);

        console.log('\n🎉 РЕМОНТ ЗАВЕРШЕН! Теперь бот должен видеть товары.');

    } catch (e) {
        console.error('❌ Ошибка при ремонте:', e);
    } finally {
        client.release();
        db.end();
    }
}

repairDatabase();
