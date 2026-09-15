/**
 * Какие папки внутри ext_modules обфусцировать.
 * Остальные модули не трогаем — npm start как обычно, обфусцированные
 * работают рядом с обычными.
 *
 * Скопируйте папку obfuscator в корень проекта (рядом с ext_modules).
 * Укажите имена модулей и запустите:
 *
 *   node obfuscator/obfuscate.cjs
 *
 * Повторный запуск берёт исходники из .src-cache, а не уже сжатый код.
 * Вернуть исходники: node obfuscator/obfuscate.cjs --restore
 */
module.exports = {
    modules: [
        // 'wrapper',
        // 'auth',
        // 'page-cms',
    ],
};
