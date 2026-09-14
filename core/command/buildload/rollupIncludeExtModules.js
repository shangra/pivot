/**
 * Плагин Rollup: кладёт ext_modules в бандл и пишет global.__EXT_MODULES__.
 *
 * Не тащит все js подряд — только main, extensions.class, routes.router
 * и соседние *.class.js. Иначе Rollup падает на кривых require вроде
 * `../core/services/memory-save`.
 *
 * Непрорезолвленные относительные require помечаются external, чтобы
 * сборка не останавливалась.
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
 */
const fs = require('fs');
const path = require('path');

function addFile(modDir, rel, acc, seen) {
    if (!rel || typeof rel !== 'string') {
        return;
    }
    const clean = rel.replace(/^[\\/]/, '');
    const abs = path.normalize(path.join(modDir, clean));
    if (seen.has(abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return;
    }
    seen.add(abs);
    acc.push({
        abs,
        key: `/${clean.replace(/\\/g, '/')}`,
    });
}

function collectClassSiblings(modDir, serviceRel, acc, seen) {
    const serviceAbs = path.join(modDir, serviceRel.replace(/^[\\/]/, ''));
    const dirs = [
        path.join(path.dirname(serviceAbs), 'metadata'),
        path.dirname(serviceAbs),
    ];
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            continue;
        }
        for (const name of fs.readdirSync(dir)) {
            if (name.endsWith('.class.js')) {
                addFile(
                    modDir,
                    path.relative(modDir, path.join(dir, name)),
                    acc,
                    seen
                );
            }
        }
    }
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
        const acc = [];
        const seen = new Set();
        addFile(modDir, pkg.main || 'index.js', acc, seen);
        addFile(modDir, 'index.js', acc, seen);
        for (const spec of Object.values(pkg.extensions || {})) {
            if (spec && typeof spec.class === 'string') {
                addFile(modDir, spec.class, acc, seen);
                collectClassSiblings(modDir, spec.class, acc, seen);
            }
        }
        for (const spec of Object.values(pkg.routes || {})) {
            if (!spec || typeof spec.router !== 'string') {
                continue;
            }
            addFile(modDir, spec.router, acc, seen);
            addFile(modDir, `routers/${path.basename(spec.router)}`, acc, seen);
        }
        mods.push({ name, pkg, files: acc });
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

function existsResolved(importer, source) {
    const resolved = path.resolve(path.dirname(importer), source);
    return [
        resolved,
        `${resolved}.js`,
        `${resolved}.cjs`,
        `${resolved}.json`,
        path.join(resolved, 'index.js'),
    ].some((candidate) => {
        try {
            return fs.existsSync(candidate);
        } catch (e) {
            return false;
        }
    });
}

function rollupIncludeExtModules(options = {}) {
    const extRoot = path.resolve(options.root || process.cwd(), 'ext_modules');

    return {
        name: 'include-ext-modules',
        resolveId(source, importer) {
            if (
                !importer ||
                typeof source !== 'string' ||
                source.startsWith('\0') ||
                !(source.startsWith('.') || source.startsWith('/'))
            ) {
                return null;
            }
            if (existsResolved(importer, source)) {
                return null;
            }
            return { id: source, external: true };
        },
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
                            return `            ${JSON.stringify(file.key)}: { load: () => { try { return require(${JSON.stringify(spec)}); } catch (e) { console.warn('[include-ext-modules]', ${JSON.stringify(spec)}, e.message); return null; } } }`;
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
