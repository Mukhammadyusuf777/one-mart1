const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('Ошибка: Переменная окружения DATABASE_URL не найдена!');
    process.exit(1);
}

const db = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const alterDatabase = async () => {
    let client;
    try {
        console.log('Подключаемся к базе данных...');
        client = await db.connect();

        console.log('1. Создаем таблицу "owners" (Владельцы)...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS owners (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT NOT NULL UNIQUE,
                name VARCHAR(255),
                phone VARCHAR(20)
            );
        `);

        console.log('2. Создаем таблицу "stores" (Магазины)...');
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

        console.log('3. Добавляем колонку "store_id" в таблицу "products"...');
        try {
            await client.query('ALTER TABLE products ADD COLUMN store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL');
        } catch (e) {
            if (e.message.includes('column "store_id" of relation "products" already exists')) {
                console.log('   (Колонка "store_id" в products уже существует, пропускаем.)');
            } else {
                throw e;
            }
        }
        
        console.log('4. Добавляем колонку "store_id" в таблицу "orders"...');
        try {
            await client.query('ALTER TABLE orders ADD COLUMN store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL');
        } catch (e) {
            if (e.message.includes('column "store_id" of relation "orders" already exists')) {
                console.log('   (Колонка "store_id" в orders уже существует, пропускаем.)');
            } else {
                throw e;
            }
        }
        
        console.log('\n--- Создание магазина по умолчанию ---');
        
        const mainAdminChatId = '5309814540'; // Ваш главный ID админа

        console.log('5. Создаем "Владельца по умолчанию" (Owner #1)...');
        const { rows: [owner] } = await client.query(
            `INSERT INTO owners (chat_id, name) VALUES ($1, 'Bosh Admin')
             ON CONFLICT (chat_id) DO UPDATE SET name = 'Bosh Admin'
             RETURNING id`,
            [mainAdminChatId]
        );
        const ownerId = owner.id;
        console.log(`   Владелец с ID ${ownerId} создан/обновлен.`);

        console.log('6. Создаем "Магазин по умолчанию" (Store #1)...');
        const { rows: [store] } = await client.query(
            `INSERT INTO stores (owner_id, name, address, latitude, longitude)
             VALUES ($1, 'One Mart (Asosiy)', 'Andijon sh.', 40.764535, 72.282204)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [ownerId]
        );
        
        let storeId;
        if (store) {
            storeId = store.id;
            console.log(`   Магазин "One Mart (Asosiy)" создан с ID ${storeId}.`);
        } else {
            const { rows: [existingStore] } = await client.query("SELECT id FROM stores WHERE owner_id = $1", [ownerId]);
            storeId = existingStore.id;
            console.log(`   Магазин "One Mart (Asosiy)" уже существует с ID ${storeId}.`);
        }

        console.log('7. Привязываем ВСЕ существующие товары к Магазину #1...');
        const { rowCount: productCount } = await client.query('UPDATE products SET store_id = $1 WHERE store_id IS NULL', [storeId]);
        console.log(`   ${productCount} товаров привязано к Магазину #${storeId}.`);

        console.log('8. Привязываем ВСЕ существующие заказы к Магазину #1...');
        const { rowCount: orderCount } = await client.query('UPDATE orders SET store_id = $1 WHERE store_id IS NULL', [storeId]);
        console.log(`   ${orderCount} заказов привязано к Магазину #${storeId}.`);


        console.log('\n✅ ✅ ✅ ОБНОВЛЕНИЕ БАЗЫ ДАННЫХ УСПЕШНО ЗАВЕРШЕНО! ✅ ✅ ✅');
        
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

alterDatabase();
