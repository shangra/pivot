/**
 * Плагин Rollup: кладёт все ext_modules в бандл и пишет global.__EXT_MODULES__.
 *
 * Без этого `commonjs({ ignoreDynamicRequires: true })` оставляет
 * require(переменный путь) на диск — без папки ext_modules дерево пустое.
 *
 * В rollup.config.cjs:
 *
 *   const includeExtModules = require('./core/command/buildload/rollupIncludeExtModules');
 *   plugins: [
 *       includeExtModules(),
 *       json(),
 *       resolve({ preferBuiltins: false }),
 *       commonjs({ ignoreDynamicRequires: true }),
 *       copy({ ... }),
 *   ]
 *
 * Extensions читает global.__EXT_MODULES__ (хуки и карта классов),
 * диск больше не нужен.
 */
const fs = require('fs');
const path = require('path');

const FILE_RE = /(?:index|service|class|controller|router)\.js$/i;

function walkFiles(dir, acc = []) {
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
            walkFiles(full, acc);
        } else if (FILE_RE.test(entry.name)) {
            acc.push(full);
        }
    }
    return acc;
}

function collectModules(extRoot) {
    if (!fs.existsSync(extRoot)) {
        return [];
    }
    const mods = [];
    for (const name of fs.readdirSync(extRoot)) {
        const modDir = path.join(extRoot, name);
        const pkgPath = path.join(modDir, 'package.json');
        if (!fs.existsSync(pkgPath) || !fs.statSync(modDir).isDirectory()) {
            continue;
        }
        let pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        } catch (e) {
            continue;
        }
        const files = walkFiles(modDir).map((abs) => ({
            abs,
            key: `/${path.relative(modDir, abs).replace(/\\/g, '/')}`,
        }));
        mods.push({ name, pkg, files });
    }
    return mods;
}

function toRequire(fromDir, absFile) {
    let rel = path.relative(fromDir, absFile).replace(/\\/g, '/');
    if (!rel.startsWith('.')) {
        rel = `./${rel}`;
    }
    return rel;
}

function rollupIncludeExtModules(options = {}) {
    const extRoot = path.resolve(options.root || process.cwd(), 'ext_modules');

    return {
        name: 'include-ext-modules',
        transform(code, id) {
            const normalized = id.replace(/\\/g, '/');
            if (!normalized.endsWith('/server.js')) {
                return null;
            }

            const fromDir = path.dirname(id);
            const mods = collectModules(extRoot);
            const fileCount = mods.reduce((n, mod) => n + mod.files.length, 0);

            const modulesLiteral = mods
                .map((mod) => {
                    const filesLiteral = mod.files
                        .map((file) => {
                            const spec = toRequire(fromDir, file.abs);
                            return `            ${JSON.stringify(file.key)}: (() => { try { return require(${JSON.stringify(spec)}); } catch (e) { console.warn('[include-ext-modules]', ${JSON.stringify(spec)}, e.message); return null; } })()`;
                        })
                        .join(',\n');
                    return `        {
            name: ${JSON.stringify(mod.name)},
            pkg: ${JSON.stringify({
                name: mod.pkg.name,
                extensions: mod.pkg.extensions || {},
                routes: mod.pkg.routes || {},
                main: mod.pkg.main,
            })},
            files: {
${filesLiteral}
            }
        }`;
                })
                .join(',\n');

            const prelude = `
global.__EXT_MODULES__ = [
${modulesLiteral}
];
console.log('[include-ext-modules] embedded', global.__EXT_MODULES__.length, 'modules,', ${fileCount}, 'files');
`;

            console.log(
                `[include-ext-modules] ${mods.length} modules, ${fileCount} files from ${extRoot}`
            );

            return {
                code: `${prelude}\n${code}`,
                map: null,
            };
        },
    };
}

module.exports = rollupIncludeExtModules;
