const { Pool } = require('pg');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ Нет DATABASE_URL');
    process.exit(1);
}

const db = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function forceFix() {
    const client = await db.connect();
    try {
        console.log('🛠 НАЧИНАЕМ ПРИНУДИТЕЛЬНЫЙ РЕМОНТ...');

        // 1. Убедимся, что есть Владелец
        // Пытаемся найти любого владельца, если нет - создаем
        let { rows: [owner] } = await client.query('SELECT * FROM owners LIMIT 1');
        
        if (!owner) {
            console.log('Владельцев нет. Создаем Главного Админа...');
            const res = await client.query(`
                INSERT INTO owners (chat_id, name, phone) 
                VALUES (5309814540, 'Super Admin', '+998900000000')
                RETURNING id;
            `);
            owner = res.rows[0];
        }
        console.log(`✅ Владелец ID: ${owner.id} найден/создан.`);

        // 2. Убедимся, что есть Магазин
        let { rows: [store] } = await client.query('SELECT * FROM stores LIMIT 1');
        
        if (!store) {
             console.log('Магазинов нет. Создаем Главный Магазин...');
             const res = await client.query(`
                INSERT INTO stores (name, address, latitude, longitude, owner_id)
                VALUES ('One Mart (Asosiy)', 'Markaz', 40.7, 72.2, $1)
                RETURNING id;
             `, [owner.id]);
             store = res.rows[0];
        }
        
        // Жестко запоминаем ID магазина
        const storeId = store.id;
        console.log(`✅ Магазин ID: ${storeId} найден/создан.`);

        // 3. САМОЕ ГЛАВНОЕ: Привязываем ВСЕ товары к этому магазину
        console.log('⏳ Привязываем товары...');
        
        const { rowCount } = await client.query('UPDATE products SET store_id = $1', [storeId]);
        
        console.log(`🎉 ГОТОВО! ${rowCount} товаров теперь привязаны к магазину ID ${storeId}.`);
        
        // Проверка
        const { rows: [check] } = await client.query('SELECT count(*) FROM products WHERE store_id = $1', [storeId]);
        console.log(`📊 Проверка базы: товаров у магазина ${storeId} ровно ${check.count} штук.`);

    } catch (e) {
        console.error('❌ Ошибка:', e);
    } finally {
        client.release();
        db.end();
    }
}

forceFix();
