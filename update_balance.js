const { Pool } = require('pg');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) process.exit(1);

const db = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function updateDB() {
    const client = await db.connect();
    try {
        console.log('⏳ Добавляем колонку balance...');
        // Добавляем колонку balance, по умолчанию 0
        await client.query('ALTER TABLE stores ADD COLUMN IF NOT EXISTS balance INTEGER DEFAULT 0');
        
        // Добавляем колонку is_commission_deducted в заказы, чтобы не списать дважды
        await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_commission_deducted BOOLEAN DEFAULT FALSE');

        console.log('✅ База данных успешно обновлена! Теперь есть баланс и контроль комиссии.');
    } catch (e) {
        console.error('Ошибка:', e);
    } finally {
        client.release();
        db.end();
    }
}
updateDB();
