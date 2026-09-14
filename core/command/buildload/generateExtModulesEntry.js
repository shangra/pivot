/**
 * Сканирует ext_modules и пишет extModules.entry.js с явными require.
 * Rollup (не webpack) видит только статический require — без этого файла
 * новые модули остаются на диске и в обфускацию не попадают.
 *
 *   node core/command/buildload/generateExtModulesEntry.js
 *
 * В rollup.config.cjs в input добавьте сгенерированный файл
 * (или импортируйте его из server.js / точки входа).
 * Затем: npm run build:bundle && npm run build:obfuscate
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const extRoot = path.join(repoRoot, 'ext_modules');
const outFile = path.join(__dirname, 'extModules.entry.js');

const FILE_RE = /(?:index|service|class|controller|router)\.js$/i;

function walk(dir, acc = []) {
    if (!fs.existsSync(dir)) {
        return acc;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
            entry.name === 'node_modules' ||
            entry.name === '_tests_' ||
            entry.name.startsWith('.')
        ) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, acc);
        } else if (FILE_RE.test(entry.name)) {
            acc.push(full);
        }
    }
    return acc;
}

const files = walk(extRoot);
const requires = files.map((file) => {
    const rel = path.relative(__dirname, file).replace(/\\/g, '/');
    const spec = rel.startsWith('.') ? rel : `./${rel}`;
    return `    require(${JSON.stringify(spec)})`;
});

const source = `/**
 * Сгенерировано generateExtModulesEntry.js — не править руками.
 * Подключить в rollup.config.cjs input вместе с server.js.
 */
module.exports = [
${requires.join(',\n')}
];
`;

fs.writeFileSync(outFile, source);
console.log(`[generateExtModulesEntry] ${files.length} files -> ${outFile}`);
