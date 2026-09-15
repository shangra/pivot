/**
 * Коробка: обфускация выбранных модулей прямо в ext_modules.
 *
 * 1. Скопировать папку obfuscator в корень проекта (рядом с ext_modules).
 * 2. Вписать имена в obfuscator/config.cjs → modules.
 * 3. npm i -D javascript-obfuscator   (один раз, в корне проекта)
 * 4. node obfuscator/obfuscate.cjs
 * 5. npm start — как обычно.
 *
 * Неуказанные модули не трогаются.
 * Исходники хранятся в obfuscator/.src-cache — повторный запуск не сжимает сжатое.
 *
 *   node obfuscator/obfuscate.cjs
 *   node obfuscator/obfuscate.cjs --dry-run
 *   node obfuscator/obfuscate.cjs --restore
 */
const fs = require('fs');
const path = require('path');

const reservedNames = require('./reservedNames');

const SKIP_DIRS = new Set([
    'node_modules',
    '_tests_',
    '.git',
    'dist',
    'dist-temp',
    'dist-obf',
    '.src-cache',
]);
const JS_EXT = new Set(['.js', '.cjs', '.mjs']);

function findRoot() {
    const seeds = [process.cwd(), path.resolve(__dirname, '..'), __dirname];
    for (const seed of seeds) {
        let dir = seed;
        for (let i = 0; i < 8; i += 1) {
            if (fs.existsSync(path.join(dir, 'ext_modules'))) {
                return dir;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
    }
    throw new Error(
        'Не найден каталог ext_modules. Скопируйте obfuscator в корень проекта.'
    );
}

function loadConfig() {
    return require(path.join(__dirname, 'config.cjs'));
}

function loadObfuscator(root) {
    try {
        return require(require.resolve('javascript-obfuscator', { paths: [root, __dirname] }));
    } catch (e) {
        throw new Error(
            'Нужен javascript-obfuscator в корне проекта: npm i -D javascript-obfuscator'
        );
    }
}

function listExtModules(extRoot) {
    if (!fs.existsSync(extRoot)) {
        return [];
    }
    return fs
        .readdirSync(extRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);
}

function shouldSkipDir(name) {
    return SKIP_DIRS.has(name) || name.startsWith('.');
}

function isJsFile(filePath) {
    return JS_EXT.has(path.extname(filePath).toLowerCase());
}

function walk(dir, acc = []) {
    if (!fs.existsSync(dir)) {
        return acc;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!shouldSkipDir(entry.name)) {
                walk(full, acc);
            }
            continue;
        }
        if (entry.isFile() && !entry.name.startsWith('.')) {
            acc.push(full);
        }
    }
    return acc;
}

function copyTree(fromDir, toDir) {
    const files = walk(fromDir);
    for (const file of files) {
        const rel = path.relative(fromDir, file);
        const dest = path.join(toDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file, dest);
    }
}

function cacheLooksFresh(cacheDir) {
    return fs.existsSync(cacheDir) && walk(cacheDir).length > 0;
}

function obfuscatorOptions() {
    return {
        compact: true,
        identifierNamesGenerator: 'mangled-shuffled',
        reservedNames,
        renameGlobals: false,
        transformObjectKeys: false,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        selfDefending: false,
        debugProtection: false,
        stringArray: true,
        stringArrayThreshold: 0.75,
        target: 'node',
    };
}

function parseFlags(argv) {
    return {
        dryRun: argv.includes('--dry-run'),
        restore: argv.includes('--restore'),
        help: argv.includes('--help') || argv.includes('-h'),
    };
}

function printHelp() {
    console.log(`node obfuscator/obfuscate.cjs [--dry-run] [--restore]

  Модули задаются в obfuscator/config.cjs → modules: ['wrapper', 'auth']
  Результат пишется в ext_modules/<имя> — npm start без смены точки входа.
  --restore  вернуть указанные модули из .src-cache`);
}

function resolveModules(config, available) {
    const names = (config.modules || []).map((name) => String(name).trim()).filter(Boolean);
    if (!names.length) {
        throw new Error(
            `В obfuscator/config.cjs укажите modules, например: modules: ['wrapper']\nДоступны: ${available.join(', ') || '(пусто)'}`
        );
    }
    const missing = names.filter((name) => !available.includes(name));
    if (missing.length) {
        throw new Error(
            `Нет таких модулей в ext_modules: ${missing.join(', ')}\nДоступны: ${available.join(', ')}`
        );
    }
    return names;
}

function main() {
    const flags = parseFlags(process.argv.slice(2));
    if (flags.help) {
        printHelp();
        return;
    }

    const root = findRoot();
    const extRoot = path.join(root, 'ext_modules');
    const cacheRoot = path.join(__dirname, '.src-cache');
    const config = loadConfig();
    const available = listExtModules(extRoot);
    const modules = resolveModules(config, available);

    console.log(
        `[obfuscator] root=${root} modules=${modules.join(', ')}${flags.dryRun ? ' dry-run' : ''}${flags.restore ? ' restore' : ''}`
    );

    let obfuscator = null;
    if (!flags.dryRun && !flags.restore) {
        obfuscator = loadObfuscator(root);
    }

    let failed = 0;
    for (const name of modules) {
        const liveDir = path.join(extRoot, name);
        const cacheDir = path.join(cacheRoot, name);

        if (flags.restore) {
            if (!cacheLooksFresh(cacheDir)) {
                throw new Error(`Нет кэша исходников для ${name}: ${cacheDir}`);
            }
            if (flags.dryRun) {
                console.log(`  restore ${name} (${walk(cacheDir).length} files)`);
                continue;
            }
            copyTree(cacheDir, liveDir);
            console.log(`  restored ${name}`);
            continue;
        }

        if (!cacheLooksFresh(cacheDir)) {
            if (flags.dryRun) {
                console.log(`  cache ${name} from ext_modules`);
            } else {
                copyTree(liveDir, cacheDir);
                console.log(`  cached ${name}`);
            }
        }

        const sourceDir = cacheLooksFresh(cacheDir) ? cacheDir : liveDir;
        const files = walk(sourceDir);
        for (const file of files) {
            const rel = path.relative(sourceDir, file);
            const dest = path.join(liveDir, rel);
            const action = isJsFile(file) ? 'obfuscate' : 'copy';
            if (flags.dryRun) {
                console.log(`  ${action} ${name}/${rel.replace(/\\/g, '/')}`);
                continue;
            }
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            if (!isJsFile(file)) {
                fs.copyFileSync(file, dest);
                continue;
            }
            try {
                const code = fs.readFileSync(file, 'utf8');
                const result = obfuscator.obfuscate(code, {
                    ...obfuscatorOptions(),
                    inputFileName: path.basename(file),
                });
                fs.writeFileSync(dest, result.getObfuscatedCode(), 'utf8');
            } catch (e) {
                failed += 1;
                console.error(`  fail ${name}/${rel}: ${e.message}`);
            }
        }
    }

    if (failed) {
        throw new Error(`Не обфусцировано файлов: ${failed}`);
    }
    if (!flags.dryRun) {
        console.log('[obfuscator] done — npm start как обычно');
    }
}

if (require.main === module) {
    try {
        main();
    } catch (e) {
        console.error('[obfuscator]', e.message);
        process.exit(1);
    }
}

module.exports = { findRoot, listExtModules };
