const { Pool } = require('pg');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('Нет DATABASE_URL');
    process.exit(1);
}

const db = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function fixStore() {
    const client = await db.connect();
    try {
        console.log('🛠 Исправляем привязку к магазину...');

        // 1. Проверяем/Создаем магазин №1
        // Пытаемся вставить магазин с ID 1. Если занято - ничего не делаем.
        // Нам нужен хотя бы один владелец, чтобы создать магазин
        await client.query(`
            INSERT INTO owners (chat_id, name, phone) 
            VALUES (0, 'System Owner', '000') 
            ON CONFLICT (chat_id) DO NOTHING;
        `);
        
        // Получаем ID любого владельца
        const { rows: [owner] } = await client.query('SELECT id FROM owners LIMIT 1');
        
        // Создаем магазин, если нет
        await client.query(`
            INSERT INTO stores (id, name, address, latitude, longitude, owner_id)
            VALUES (1, 'One Mart (Asosiy)', 'Markaz', 40.0, 72.0, $1)
            ON CONFLICT (id) DO NOTHING;
        `, [owner.id]);

        console.log('✅ Магазин №1 гарантированно существует.');

        // 2. ПРИВЯЗЫВАЕМ ВСЕ ТОВАРЫ К МАГАЗИНУ №1
        const { rowCount } = await client.query('UPDATE products SET store_id = 1');
        
        console.log(`✅ УСПЕХ! ${rowCount} товаров привязаны к магазину №1.`);
        console.log('Теперь бот их увидит.');

    } catch (e) {
        console.error('Ошибка:', e);
    } finally {
        client.release();
        db.end();
    }
}

fixStore();
