/**
 * Обфусцирует каждый JS-файл отдельно. Пути, имена файлов и require
 * не меняются — CMS по-прежнему находит модули на диске.
 *
 * Не трогает исходники: пишет копию в --out (по умолчанию dist-obf).
 *
 *   node core/command/buildload/obfuscateModules.js
 *   node core/command/buildload/obfuscateModules.js --src ext_modules --out dist-obf
 *   node core/command/buildload/obfuscateModules.js --src ext_modules --src core --dry-run
 *
 * Rollup-бандл (build:bundle / build:obfuscate) этот скрипт не заменяет.
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
]);

const JS_EXT = new Set(['.js', '.cjs', '.mjs']);

function loadObfuscator() {
    try {
        return require('javascript-obfuscator');
    } catch (e) {
        throw new Error(
            'Нужен пакет javascript-obfuscator. Установите его в корне проекта: npm i -D javascript-obfuscator'
        );
    }
}

function parseArgs(argv) {
    const options = {
        root: process.cwd(),
        src: [],
        out: 'dist-obf',
        dryRun: false,
        inPlace: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === '--root' && next) {
            options.root = next;
            i += 1;
        } else if (arg === '--src' && next) {
            options.src.push(next);
            i += 1;
        } else if (arg === '--out' && next) {
            options.out = next;
            i += 1;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--in-place') {
            options.inPlace = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        }
    }

    if (!options.src.length) {
        options.src = ['ext_modules'];
    }

    return options;
}

function printHelp() {
    console.log(`Usage:
  node core/command/buildload/obfuscateModules.js [options]

Options:
  --src <dir>     Каталог относительно --root (можно несколько раз). По умолчанию: ext_modules
  --out <dir>     Куда писать копию. По умолчанию: dist-obf
  --root <dir>    Корень проекта. По умолчанию: cwd
  --dry-run       Только список файлов, ничего не писать
  --in-place      Писать поверх исходников (опасно, без --out)
  -h, --help      Эта справка`);
}

function isJsFile(filePath) {
    return JS_EXT.has(path.extname(filePath).toLowerCase());
}

function shouldSkipDir(name) {
    return SKIP_DIRS.has(name) || name.startsWith('.');
}

function walk(dir, acc = []) {
    if (!fs.existsSync(dir)) {
        return acc;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (shouldSkipDir(entry.name)) {
                continue;
            }
            walk(path.join(dir, entry.name), acc);
            continue;
        }
        if (entry.isFile() && !entry.name.startsWith('.')) {
            acc.push(path.join(dir, entry.name));
        }
    }
    return acc;
}

function resolveUnderRoot(root, target) {
    return path.isAbsolute(target)
        ? path.normalize(target)
        : path.normalize(path.join(root, target));
}

function assertNotWritingIntoSource(srcDirs, outDir) {
    const outResolved = path.resolve(outDir);
    for (const src of srcDirs) {
        const srcResolved = path.resolve(src);
        if (
            outResolved === srcResolved ||
            outResolved.startsWith(`${srcResolved}${path.sep}`)
        ) {
            throw new Error(
                `Отказ: --out (${outDir}) лежит внутри --src (${src}). Укажите другой --out или --in-place.`
            );
        }
    }
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

function obfuscateSource(obfuscator, code, filePath) {
    const result = obfuscator.obfuscate(code, {
        ...obfuscatorOptions(),
        inputFileName: path.basename(filePath),
    });
    return result.getObfuscatedCode();
}

function destPath(root, outDir, absFile) {
    const rel = path.relative(root, absFile);
    if (rel.startsWith('..')) {
        throw new Error(`Файл вне --root: ${absFile}`);
    }
    return path.join(outDir, rel);
}

function ensureDir(filePath, dryRun) {
    if (dryRun) {
        return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const root = path.resolve(options.root);
    const srcDirs = options.src.map((item) => resolveUnderRoot(root, item));
    const missing = srcDirs.filter((dir) => !fs.existsSync(dir));
    if (missing.length) {
        throw new Error(`Нет каталога: ${missing.join(', ')}`);
    }

    const outDir = options.inPlace
        ? null
        : resolveUnderRoot(root, options.out);
    if (!options.inPlace) {
        assertNotWritingIntoSource(srcDirs, outDir);
    }

    const files = [];
    for (const src of srcDirs) {
        walk(src, files);
    }

    const unique = [...new Set(files.map((file) => path.normalize(file)))];
    const jsFiles = unique.filter(isJsFile);
    const otherFiles = unique.filter((file) => !isJsFile(file));

    console.log(
        `[obfuscate-modules] root=${root} src=${srcDirs.length} files=${unique.length} js=${jsFiles.length} copy=${otherFiles.length}${options.dryRun ? ' dry-run' : ''}${options.inPlace ? ' in-place' : ` out=${outDir}`}`
    );

    let obfuscator = null;
    if (jsFiles.length && !options.dryRun) {
        obfuscator = loadObfuscator();
    }

    let failed = 0;
    for (const file of jsFiles) {
        const dest = options.inPlace ? file : destPath(root, outDir, file);
        if (options.dryRun) {
            console.log(`  obfuscate ${path.relative(root, file)}`);
            continue;
        }
        try {
            const code = fs.readFileSync(file, 'utf8');
            const obfuscated = obfuscateSource(obfuscator, code, file);
            ensureDir(dest, false);
            fs.writeFileSync(dest, obfuscated, 'utf8');
        } catch (e) {
            failed += 1;
            console.error(
                `[obfuscate-modules] fail ${path.relative(root, file)}: ${e.message}`
            );
        }
    }

    for (const file of otherFiles) {
        const dest = options.inPlace ? file : destPath(root, outDir, file);
        if (options.dryRun) {
            console.log(`  copy ${path.relative(root, file)}`);
            continue;
        }
        if (options.inPlace) {
            continue;
        }
        ensureDir(dest, false);
        fs.copyFileSync(file, dest);
    }

    if (failed) {
        throw new Error(`Не обфусцировано файлов: ${failed}`);
    }
    if (!options.dryRun) {
        console.log('[obfuscate-modules] done');
    }
}

if (require.main === module) {
    try {
        main();
    } catch (e) {
        console.error('[obfuscate-modules]', e.message);
        process.exit(1);
    }
}

module.exports = {
    parseArgs,
    walk,
    isJsFile,
    obfuscatorOptions,
};
