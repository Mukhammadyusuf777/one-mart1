const fs = require('fs');

console.log("--- Запуск проверки файла products.json ---");

try {
    const db = JSON.parse(fs.readFileSync('products.json', 'utf8'));

    if (!db.categories || !db.products) {
        console.error("ОШИБКА: В файле отсутствуют обязательные поля 'categories' или 'products'.");
        return;
    }

    const validCategoryIds = db.categories.map(cat => cat.id);
    console.log("Правильные ID категорий:", validCategoryIds);
    console.log("\nПроверяем каждый товар...");

    let errorsFound = 0;
    db.products.forEach(product => {
        if (!product.category || !validCategoryIds.includes(product.category)) {
            console.log(`\n\x1b[31m%s\x1b[0m`, `!!! НАЙДЕНА ОШИБКА !!!`);
            console.log(`  - Товар: "${product.name}" (ID: ${product.id})`);
            console.log(`  - У него указана НЕПРАВИЛЬНАЯ категория: "${product.category}"`);
            errorsFound++;
        }
    });

    console.log("\n--- Проверка завершена ---");
    if (errorsFound === 0) {
        console.log("\x1b[32m%s\x1b[0m", "✅ Ошибок в категориях товаров не найдено.");
    } else {
        console.log(`❌ Найдено ошибок: ${errorsFound}. Пожалуйста, исправьте эти ошибки в файле products.json.`);
    }

} catch (e) {
    console.error("\x1b[31m%s\x1b[0m", "КРИТИЧЕСКАЯ ОШИБКА: Ваш файл products.json содержит синтаксическую ошибку.");
    console.error("Детали:", e.message);
}