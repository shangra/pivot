class Extensions {
    static DEBUG = true;

    static log(...args) {
        if (Extensions.DEBUG) {
            console.log('[Extensions]', ...args);
        }
    }

    static error(...args) {
        console.error('[Extensions]', ...args);
    }

    /**
     * Короткий дамп, чтобы не залить лог целым деревом.
     * @private
     */
    static dump(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (Array.isArray(value)) {
            const first = value[0];
            return {
                type: 'array',
                length: value.length,
                firstKeys:
                    first && typeof first === 'object'
                        ? Object.keys(first).slice(0, 12)
                        : first,
            };
        }
        if (typeof value === 'function') {
            return `[Function ${value.name || 'anonymous'}]`;
        }
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            return {
                type: 'object',
                keys: keys.slice(0, 20),
                keysCount: keys.length,
            };
        }
        return value;
    }

    /**
     * @private
     */
    static dumpKey(key) {
        if (typeof key === 'function') {
            return `[Function ${key.name || 'anonymous'}]`;
        }
        return key;
    }

    /**
     * @constructor
     */
    constructor() {
        this.extendService();

        // при спреде эти свойства не попадут в результат
        Object.defineProperties(this, {
            childrenClassName: {
                value: this.constructor.name,
                configurable: true,
                enumerable: false,
            },
            STATE: {
                value: {
                    before: 'before',
                    inner: 'inner',
                    after: 'after',
                    decorate: 'decorate',
                },
                configurable: true,
                enumerable: false,
            },
        });
    }

    /**
     * Реестр хуков: либо Map с ключом-функцией, либо объект
     * `Class.method.after` — как в package.json.
     * @private
     */
    static getHookStore() {
        const hooks =
            (typeof sreda !== 'undefined' && sreda.hooks) ||
            (typeof global !== 'undefined' && global.sreda?.hooks) ||
            null;
        if (!hooks) {
            return { hooks: null, keys: [] };
        }

        const isMap =
            typeof hooks.get === 'function' &&
            typeof hooks.set === 'function' &&
            typeof hooks.keys === 'function' &&
            !Array.isArray(hooks);

        const keys = new Set();
        if (isMap) {
            for (const key of hooks.keys()) {
                keys.add(key);
            }
        }
        try {
            for (const key of Object.keys(hooks)) {
                keys.add(key);
            }
        } catch (e) {
            // Map без строковых ключей
        }
        const list = [...keys];
        if (!Extensions._loggedHookStore) {
            Extensions._loggedHookStore = true;
            Extensions.log('hook store', {
                isMap,
                hooksType: hooks?.constructor?.name,
                keysCount: list.length,
                keys: list.slice(0, 80).map((key) => Extensions.dumpKey(key)),
            });
        }
        return { hooks, keys: list };
    }

    /**
     * @private
     */
    static getConstructorNames(constructor, prototype) {
        const names = [];
        if (constructor?.name) {
            names.push(constructor.name);
        }
        if (prototype?._hookClassName) {
            names.push(prototype._hookClassName);
        }
        try {
            const source = constructor?.toString?.() || '';
            const classMatch = source.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
            if (classMatch) {
                names.push(classMatch[1]);
            }
            const fnMatch = source.match(/\bfunction\s+([A-Za-z_$][\w$]*)/);
            if (fnMatch && fnMatch[1] !== 'async') {
                names.push(fnMatch[1]);
            }
        } catch (e) {
            // toString недоступен
        }
        return [...new Set(names.filter(Boolean))];
    }

    /**
     * Хуки есть, если ключ — сама функция (бандл) или строка Class.method.state.
     * @private
     */
    static parseHookKey(key) {
        if (typeof key !== 'string') {
            return null;
        }
        const matched = key.match(
            /^([^.]+)\.(.+)\.(before|inner|after|decorate)$/
        );
        if (!matched) {
            return null;
        }
        return {
            className: matched[1],
            methodName: matched[2],
            state: matched[3],
        };
    }

    /**
     * В бандле constructor.name сжат. MetadataService узнаём по своим методам,
     * Roles/Rules так не оборачиваем — иначе хук дерева зациклится.
     * @private
     */
    static prototypeBelongsToHookClass(prototype, hookClass) {
        if (!prototype || !hookClass) {
            return false;
        }
        try {
            const source = prototype.constructor?.toString?.() || '';
            if (source.includes(`class ${hookClass}`) || source.includes(`function ${hookClass}`)) {
                return true;
            }
        } catch (e) {
            // toString недоступен
        }

        const names = Object.getOwnPropertyNames(prototype);
        if (hookClass === 'MetadataService') {
            return (
                names.includes('getClassInstance') &&
                (names.includes('getMetadatasV3') || names.includes('setMetadata'))
            );
        }
        return false;
    }

    /**
     * @private
     */
    static methodHasHooks(
        originalMethod,
        methodName,
        classNames,
        hookKeys,
        hooks,
        prototype
    ) {
        if (hookKeys.includes(originalMethod)) {
            return true;
        }
        const states = ['before', 'inner', 'after', 'decorate'];
        if (
            classNames.some((name) =>
                states.some((state) => {
                    const key = `${name}.${methodName}.${state}`;
                    return hookKeys.includes(key) || Boolean(hooks?.[key]);
                })
            )
        ) {
            return true;
        }

        return hookKeys.some((key) => {
            const parsed = Extensions.parseHookKey(key);
            return (
                parsed &&
                parsed.methodName === methodName &&
                Extensions.prototypeBelongsToHookClass(prototype, parsed.className)
            );
        });
    }

    /**
     * @private
     */
    static collectTriggers(entry, functionState) {
        if (!entry) {
            return [];
        }
        if (Array.isArray(entry)) {
            return entry.filter((trigger) => {
                const type = trigger?.info?.hookType || trigger?.info?.state;
                return !type || type === functionState;
            });
        }
        if (entry[functionState]) {
            return entry[functionState];
        }
        return [];
    }

    /**
     * @private
     */
    static getTriggers(sourceMethod, methodName, functionState, context) {
        const { hooks } = Extensions.getHookStore();
        if (!hooks) {
            return [];
        }

        const seen = new Set();
        const triggers = [];
        const push = (entry) => {
            for (const trigger of Extensions.collectTriggers(entry, functionState)) {
                if (trigger && !seen.has(trigger)) {
                    seen.add(trigger);
                    triggers.push(trigger);
                }
            }
        };

        if (sourceMethod && typeof hooks.get === 'function') {
            push(hooks.get(sourceMethod));
        }
        if (sourceMethod && hooks[sourceMethod]) {
            push(hooks[sourceMethod]);
        }

        const classNames = Extensions.getConstructorNames(
            context?.constructor,
            Object.getPrototypeOf(context)
        );
        if (context?.childrenClassName) {
            classNames.unshift(context.childrenClassName);
        }
        for (const name of classNames) {
            push(hooks[`${name}.${methodName}.${functionState}`]);
        }

        const prototype = Object.getPrototypeOf(context);
        const { keys: hookKeys } = Extensions.getHookStore();
        for (const key of hookKeys) {
            const parsed = Extensions.parseHookKey(key);
            if (
                parsed &&
                parsed.methodName === methodName &&
                parsed.state === functionState &&
                Extensions.prototypeBelongsToHookClass(prototype, parsed.className)
            ) {
                push(hooks[key]);
            }
        }

        if (
            functionState === 'after' ||
            methodName === 'getClassesMetadata' ||
            methodName === 'getTreeChildrenV2' ||
            methodName === 'getTreeChildrenV3'
        ) {
            Extensions.log('getTriggers', {
                methodName,
                functionState,
                constructorName: context?.constructor?.name,
                childrenClassName: context?.childrenClassName,
                classNames,
                sourceMethod: Extensions.dump(sourceMethod),
                triggerCount: triggers.length,
                hookNames: triggers.map(
                    (trigger) =>
                        trigger?.hook?.name ||
                        trigger?.info?.function ||
                        'anonymous'
                ),
            });
        }

        return triggers;
    }

    /**
     * @private
     */
    static findMethodName(context, sourceMethod) {
        const prototype = Object.getPrototypeOf(context);
        const map = prototype?._sourceMethods;
        if (map && typeof map.entries === 'function') {
            for (const [name, data] of map.entries()) {
                if (data === sourceMethod || data?.fn === sourceMethod) {
                    return name;
                }
            }
        }
        return typeof sourceMethod === 'string' ? sourceMethod : sourceMethod?.name || '';
    }

    /**
     * @private
     */
    static getFunctionSource(func) {
        if (typeof func !== 'function') {
            return '';
        }
        try {
            const source = func.toString();
            return source.includes('[native code]') ? '' : source;
        } catch (e) {
            return '';
        }
    }

    /**
     * @private
     */
    static getFuncParamNames(func) {
        if (typeof func !== 'function') {
            return [];
        }

        const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/gm;
        const ARGUMENT_NAMES = /(?:\.{3})?([A-Za-z_$][\w$]*)/;

        try {
            const fnStr = func.toString().replace(STRIP_COMMENTS, '');
            if (fnStr.includes('[native code]')) {
                return [];
            }
            const fnArgs = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')'));
            if (!fnArgs.trim()) {
                return [];
            }
            return fnArgs.split(',').map((arg) => {
                const trimmed = arg.trim();
                const matched = trimmed.match(ARGUMENT_NAMES);
                return matched ? matched[1] : trimmed;
            }).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    /**
     * Как у другой команды: имена, если ещё есть, плюс позиция.
     * id / options — запасные имена после Babel.
     * @private
     */
    static buildFunctionParams(paramNames, args, instance) {
        const functionParams = { this: instance };

        (paramNames || []).forEach((name, i) => {
            if (i < args.length) {
                functionParams[name] = args[i];
            }
        });
        args.forEach((arg, i) => {
            functionParams[i] = arg;
        });
        if (args.length > 0) {
            functionParams.id = args[0];
            functionParams.metadata_id = args[0];
        }
        if (args.length > 1) {
            functionParams.options = args[1];
        }
        functionParams.args = args;
        functionParams.length = args.length;

        Object.defineProperty(functionParams, '$args', {
            value: args,
            enumerable: false,
        });
        return functionParams;
    }

    /**
     * Экземпляр модуля из триггера, не MetadataService.
     * @private
     */
    static getTriggerInstance(trigger) {
        if (!trigger) {
            return null;
        }
        return (
            trigger.instance ||
            trigger.this ||
            trigger.context ||
            trigger.service ||
            trigger.info?.instance ||
            trigger.info?.this ||
            trigger.info?.service ||
            trigger.info?.object ||
            null
        );
    }

    /**
     * Webpack-require не открывает произвольный путь с диска.
     * @private
     */
    static nodeRequire(id) {
        if (typeof __non_webpack_require__ === 'function') {
            return __non_webpack_require__(id);
        }
        return require(id);
    }

    /**
     * Каталоги, где лежат модули: cwd, папка бандла, ext_modules.
     * @private
     */
    static getModuleRoots() {
        const fs = require('fs');
        const path = require('path');
        const roots = new Set();
        const add = (dir) => {
            if (!dir) {
                return;
            }
            try {
                if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                    roots.add(path.resolve(dir));
                    const ext = path.join(dir, 'ext_modules');
                    if (fs.existsSync(ext) && fs.statSync(ext).isDirectory()) {
                        roots.add(path.resolve(ext));
                    }
                }
            } catch (e) {
                // каталог недоступен
            }
        };
        add(process.cwd());
        if (process.argv[1]) {
            add(path.dirname(process.argv[1]));
        }
        try {
            if (typeof require !== 'undefined' && require.main?.filename) {
                add(path.dirname(require.main.filename));
            }
        } catch (e) {
            // require.main нет в бандле
        }
        return [...roots];
    }

    /**
     * Все `extensions.class` из package.json модулей.
     * Путь на диске не зависит от обфусцированного constructor.name.
     * @private
     */
    static collectExtensionServicePaths() {
        if (Extensions._extServicePaths) {
            return Extensions._extServicePaths;
        }
        const fs = require('fs');
        const path = require('path');
        const found = [];
        const seen = new Set();

        const considerDir = (modDir) => {
            const pkgPath = path.join(modDir, 'package.json');
            if (!fs.existsSync(pkgPath)) {
                return;
            }
            let pkg;
            try {
                pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            } catch (e) {
                return;
            }
            const extensions = pkg.extensions || {};
            for (const [key, info] of Object.entries(extensions)) {
                if (!info || typeof info.class !== 'string') {
                    continue;
                }
                const rel = info.class.replace(/^[\\/]/, '');
                const abs = path.join(modDir, rel);
                const token = `${abs}|${info.function || ''}`;
                if (!fs.existsSync(abs) || seen.has(token)) {
                    continue;
                }
                seen.add(token);
                found.push({
                    key,
                    functionName: info.function,
                    servicePath: abs,
                });
            }
        };

        for (const root of Extensions.getModuleRoots()) {
            considerDir(root);
            try {
                for (const name of fs.readdirSync(root)) {
                    considerDir(path.join(root, name));
                }
            } catch (e) {
                // не каталог модулей
            }
        }

        Extensions._extServicePaths = found;
        Extensions.log('package extension services', {
            count: found.length,
            items: found.map((item) => ({
                key: item.key,
                functionName: item.functionName,
                path: item.servicePath,
            })),
        });
        return found;
    }

    /**
     * Следующий ещё не занятый *.service.js для этого метода хука.
     * @private
     */
    static claimPackageServicePath(functionName) {
        if (!functionName) {
            return null;
        }
        if (!Extensions._claimedServicePaths) {
            Extensions._claimedServicePaths = new Set();
        }
        for (const entry of Extensions.collectExtensionServicePaths()) {
            if (entry.functionName !== functionName) {
                continue;
            }
            if (Extensions._claimedServicePaths.has(entry.servicePath)) {
                continue;
            }
            Extensions._claimedServicePaths.add(entry.servicePath);
            return entry.servicePath;
        }
        return null;
    }

    /**
     * После обфускации часть хуков не находит свой сервис по имени класса.
     * Прогоняем те же методы с диска — карта классов собирается целиком.
     * @private
     */
    static async applyPackageHooks(
        methodName,
        result,
        functionParams,
        originalMethod
    ) {
        const entries = Extensions.collectExtensionServicePaths().filter(
            (entry) => entry.functionName === methodName
        );
        if (!entries.length) {
            return result;
        }

        const path = require('path');
        const seen = new Set();
        let merged = result;
        for (const entry of entries) {
            if (seen.has(entry.servicePath)) {
                continue;
            }
            seen.add(entry.servicePath);
            try {
                const Loaded = Extensions.nodeRequire(entry.servicePath);
                const ctor = Loaded?.default || Loaded;
                const instance =
                    typeof ctor === 'function' ? new ctor() : ctor;
                if (instance) {
                    instance.dirname = path.dirname(entry.servicePath);
                }
                const method = instance?.[methodName];
                if (typeof method !== 'function') {
                    continue;
                }
                const next = await method.call(
                    instance,
                    merged,
                    functionParams,
                    originalMethod
                );
                if (next !== undefined) {
                    merged = next;
                }
                Extensions.log('package hook', {
                    methodName,
                    servicePath: entry.servicePath,
                    receiverId: instance?.id,
                    resultOut: Extensions.dump(merged),
                });
            } catch (e) {
                Extensions.log('package hook failed', {
                    methodName,
                    servicePath: entry.servicePath,
                    message: e.message,
                });
            }
        }
        return merged;
    }

    /**
     * В бандле __dirname у модуля пустой. Ищем исходный *.service.js на диске
     * по строке из package.json или по имени конструктора (RolesService).
     * @private
     */
    static resolveServicePath(info) {
        const rel = info?.path || info?.file;
        const classRef = info?.class;
        const fs = require('fs');
        const path = require('path');
        const cwd = process.cwd();
        const names = [];

        if (typeof rel === 'string') {
            names.push(path.basename(rel), rel.replace(/^[\\/]/, ''));
        }
        if (typeof classRef === 'string') {
            names.push(path.basename(classRef), classRef.replace(/^[\\/]/, ''));
        }
        if (typeof classRef === 'function' && classRef.name) {
            const name = classRef.name;
            names.push(
                `${name}.js`,
                `${name.replace(/Service$/, '')}.service.js`,
                `${name.replace(/Class$/, '')}.class.js`
            );
        }

        const uniqueNames = [...new Set(names.filter(Boolean))];
        if (!uniqueNames.length) {
            return null;
        }

        const candidates = [];
        for (const fileName of uniqueNames) {
            candidates.push(
                path.join(cwd, fileName),
                path.join(cwd, 'ext_modules', fileName)
            );
        }

        try {
            const extRoot = path.join(cwd, 'ext_modules');
            if (fs.existsSync(extRoot)) {
                for (const mod of fs.readdirSync(extRoot)) {
                    const servicesDir = path.join(extRoot, mod, 'services');
                    for (const fileName of uniqueNames) {
                        candidates.push(
                            path.join(extRoot, mod, fileName),
                            path.join(servicesDir, path.basename(fileName))
                        );
                    }
                }
            }
        } catch (e) {
            // нет ext_modules рядом с процессом
        }

        for (const candidate of candidates) {
            try {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                    if (!Extensions._claimedServicePaths) {
                        Extensions._claimedServicePaths = new Set();
                    }
                    Extensions._claimedServicePaths.add(candidate);
                    return candidate;
                }
            } catch (e) {
                // путь недоступен
            }
        }
        return null;
    }

    /**
     * @private
     */
    static loadHookReceiver(trigger, info) {
        const path = require('path');
        const functionName = info?.function;
        let instance = Extensions.getTriggerInstance(trigger);
        const Service = typeof info?.class === 'function' ? info.class : null;
        let servicePath = Extensions.resolveServicePath(info);
        if (!servicePath) {
            servicePath = Extensions.claimPackageServicePath(functionName);
        }

        // Диск важнее обфусцированного конструктора: там живые __dirname и id.
        if (servicePath) {
            try {
                const Loaded = Extensions.nodeRequire(servicePath);
                const ctor = Loaded?.default || Loaded;
                instance = typeof ctor === 'function' ? new ctor() : ctor;
            } catch (e) {
                Extensions.log('loadHookReceiver disk failed', {
                    servicePath,
                    message: e.message,
                });
            }
        }

        if (!instance && Service) {
            try {
                instance = new Service();
            } catch (e) {
                Extensions.log('new info.class failed', {
                    className: Service.name,
                    message: e.message,
                });
            }
        }

        if (instance && servicePath) {
            instance.dirname = path.dirname(servicePath);
        }

        return { instance, functionName, servicePath };
    }

    /**
     * Старые хуки: hook(result). Новые: hook(result, params, original).
     * getClassesMetadata должен бежать на экземпляре модуля (Roles/Rules),
     * а не на MetadataService — иначе this.id = нули и this.dirname пустой.
     * @private
     */
    static async invokeHook(
        hook,
        result,
        functionParams,
        originalMethod,
        info,
        trigger
    ) {
        if (typeof hook !== 'function') {
            return result;
        }

        const receiver = Extensions.loadHookReceiver(trigger, info);
        const hookThis = receiver.instance;
        const methodName = receiver.functionName;
        const method =
            hookThis && methodName && typeof hookThis[methodName] === 'function'
                ? hookThis[methodName]
                : hook;

        Extensions.log('invokeHook in', {
            hook: hook.name || 'anonymous',
            hookLength: hook.length,
            resultIn: Extensions.dump(result),
            info,
            triggerKeys: trigger ? Object.keys(trigger) : [],
            receiverId: hookThis?.id,
            receiverDirname: hookThis?.dirname,
            receiverConstructor: hookThis?.constructor?.name,
            servicePath: receiver.servicePath,
            viaInstance: Boolean(hookThis && method !== hook),
        });

        const next =
            hookThis && method !== hook
                ? await method.call(hookThis, result, functionParams, originalMethod)
                : hookThis
                  ? await hook.call(hookThis, result, functionParams, originalMethod)
                  : await hook(result, functionParams, originalMethod);

        Extensions.log('invokeHook out', {
            hook: hook.name || 'anonymous',
            returnedUndefined: next === undefined,
            resultOut: Extensions.dump(next === undefined ? result : next),
        });
        return next === undefined ? result : next;
    }

    /**
     * @private
     */
    static async hook(
        sourceMethod,
        functionState,
        functionResult,
        functionParams,
        context,
        originalMethod
    ) {
        Extensions.wrapKnownPrototypes();

        let trace = false;
        let result = await functionResult;
        const methodName = Extensions.findMethodName(context, sourceMethod);
        const triggers = Extensions.getTriggers(
            sourceMethod,
            methodName,
            functionState,
            context
        );

        for (const trigger of triggers) {
            const { info, hook } = trigger;
            if (info?.once) {
                const { hooks } = Extensions.getHookStore();
                if (hooks && typeof hooks.get === 'function') {
                    const current = hooks.get(sourceMethod) || [];
                    if (Array.isArray(current)) {
                        hooks.set(
                            sourceMethod,
                            current.filter((item) => item !== trigger)
                        );
                    }
                }
            }
            try {
                result = await Extensions.invokeHook(
                    hook,
                    result,
                    functionParams,
                    originalMethod,
                    info,
                    trigger
                );
                trace = true;
            } catch (e) {
                Extensions.error('hook threw', {
                    hook: hook?.name || 'anonymous',
                    functionState,
                    constructorName: context?.constructor?.name,
                    message: e.message,
                    stack: e.stack,
                });
                throw e;
            }
        }

        if (
            functionState === 'after' &&
            (methodName === 'getClassesMetadata' ||
                methodName === 'getTreeChildrenV2' ||
                methodName === 'getTreeChildrenV3')
        ) {
            result = await Extensions.applyPackageHooks(
                methodName,
                result,
                functionParams,
                originalMethod
            );
        }

        return { trace, result };
    }

    /**
     * @private
     */
    static async before(sourceMethod, functionResult, functionParams, context) {
        return this.hook(
            sourceMethod,
            context.STATE.before,
            functionResult,
            functionParams,
            context
        );
    }

    /**
     * @private
     */
    static async inner(sourceMethod, functionResult, functionParams, context) {
        return this.hook(
            sourceMethod,
            context.STATE.inner,
            functionResult,
            functionParams,
            context
        );
    }

    /**
     * @private
     */
    static async after(sourceMethod, functionResult, functionParams, context) {
        return this.hook(
            sourceMethod,
            context.STATE.after,
            functionResult,
            functionParams,
            context
        );
    }

    /**
     * @private
     */
    static async decorate(
        sourceMethod,
        functionResult,
        functionParams,
        context,
        originalMethod
    ) {
        return this.hook(
            sourceMethod,
            context.STATE.decorate,
            functionResult,
            functionParams,
            context,
            originalMethod
        );
    }

    /**
     * @private
     */
    static createWrapper(prototype, methodName) {
        return async function (...args) {
            Extensions.wrapKnownPrototypes();

            const sourceData = prototype._sourceMethods.get(methodName);
            const sourceMethod = sourceData.fn;
            const functionParams = Extensions.buildFunctionParams(
                sourceData.paramNames,
                args,
                this
            );

            Extensions.log('CALL', {
                constructorName: this.constructor.name,
                methodName,
                hookClassName: prototype._hookClassName,
                argsCount: args.length,
                args0: args[0],
                args1Type: typeof args[1],
                paramNames: sourceData.paramNames,
            });

            let { result } = await Extensions.before(
                sourceMethod,
                undefined,
                functionParams,
                this
            );
            ({ result } = await Extensions.inner(
                sourceMethod,
                result,
                functionParams,
                this
            ));

            const decorated = await Extensions.decorate(
                sourceMethod,
                result,
                functionParams,
                this,
                sourceMethod.bind(this)
            );

            if (decorated.trace) {
                Extensions.log('source skipped by decorate', methodName);
                result = decorated.result;
            } else {
                Extensions.log('source.apply', {
                    methodName,
                    argsCount: args.length,
                    args0: args[0],
                });
                result = await sourceMethod.apply(this, args);
                Extensions.log('source result', {
                    methodName,
                    result: Extensions.dump(result),
                });
            }

            ({ result } = await Extensions.after(
                sourceMethod,
                result,
                functionParams,
                this
            ));

            Extensions.log('RETURN', {
                constructorName: this.constructor.name,
                methodName,
                result: Extensions.dump(result),
            });

            return result;
        };
    }

    /**
     * @private
     */
    static wrapPrototype(prototype) {
        if (!prototype || prototype === Object.prototype) {
            return;
        }

        const { hooks, keys: hookKeys } = Extensions.getHookStore();
        if (!hooks || !hookKeys.length) {
            if (!prototype._loggedNoHooks) {
                prototype._loggedNoHooks = true;
                Extensions.log('wrap skip: no hooks', {
                    constructorName: prototype.constructor?.name,
                });
            }
            return;
        }

        const classNames = Extensions.getConstructorNames(
            prototype.constructor,
            prototype
        );
        if (!prototype._loggedWrap) {
            prototype._loggedWrap = true;
            Extensions.log('wrapPrototype', {
                constructorName: prototype.constructor?.name,
                classNames,
                protoMethods: Object.getOwnPropertyNames(prototype).filter(
                    (method) =>
                        method !== 'constructor' &&
                        typeof prototype[method] === 'function'
                ),
                alreadyWrapped: prototype._sourceMethods
                    ? [...prototype._sourceMethods.keys()]
                    : [],
            });
        }
        if (!prototype._sourceMethods) {
            prototype._sourceMethods = new Map();
        }

        const methods = Object.getOwnPropertyNames(prototype).filter(
            (method) =>
                method !== 'constructor' &&
                typeof prototype[method] === 'function'
        );

        for (const methodName of methods) {
            if (prototype._sourceMethods.has(methodName)) {
                continue;
            }

            const originalMethod = prototype[methodName];
            if (
                !Extensions.methodHasHooks(
                    originalMethod,
                    methodName,
                    classNames,
                    hookKeys,
                    hooks,
                    prototype
                )
            ) {
                if (
                    methodName === 'getClassesMetadata' ||
                    methodName === 'getTreeChildrenV2' ||
                    methodName === 'getTreeChildrenV3'
                ) {
                    if (!prototype._loggedSkip) {
                        prototype._loggedSkip = new Set();
                    }
                    if (!prototype._loggedSkip.has(methodName)) {
                        prototype._loggedSkip.add(methodName);
                        Extensions.log('wrap skip method', {
                            constructorName: prototype.constructor?.name,
                            methodName,
                            classNames,
                        });
                    }
                }
                continue;
            }

            if (!prototype._hookClassName) {
                const matched =
                    classNames.find((name) =>
                        hookKeys.some((key) => {
                            const parsed = Extensions.parseHookKey(key);
                            return (
                                parsed &&
                                parsed.className === name &&
                                parsed.methodName === methodName
                            );
                        })
                    ) ||
                    hookKeys
                        .map((key) => Extensions.parseHookKey(key))
                        .find(
                            (parsed) =>
                                parsed &&
                                parsed.methodName === methodName &&
                                Extensions.prototypeBelongsToHookClass(
                                    prototype,
                                    parsed.className
                                )
                        )?.className;
                if (matched) {
                    prototype._hookClassName = matched;
                }
            }

            const paramNames = Extensions.getFuncParamNames(originalMethod);
            prototype._sourceMethods.set(methodName, {
                fn: originalMethod,
                paramNames,
            });
            prototype[methodName] = Extensions.createWrapper(
                prototype,
                methodName
            );
            Extensions.log('wrapped', {
                constructorName: prototype.constructor?.name,
                methodName,
                hookClassName: prototype._hookClassName,
                paramNames,
            });
        }

        Extensions.patchGetClassInstance(prototype);
    }

    /**
     * getClassInstance делает require(путь). В бандле путь с диска
     * иногда не открывается webpack-require — берём обычный Node require
     * или сам конструктор, если хук уже положил функцию.
     * @private
     */
    static patchGetClassInstance(prototype) {
        if (
            typeof prototype.getClassInstance !== 'function' ||
            prototype._patchedGetClassInstance
        ) {
            return;
        }
        prototype._patchedGetClassInstance = true;
        const original = prototype.getClassInstance;
        prototype.getClassInstance = function (ext, classId, parent) {
            const entry = ext?.[classId];
            if (typeof entry === 'function') {
                return new entry({ owner_id: parent });
            }
            if (typeof entry === 'string') {
                const loaders = [require];
                if (typeof __non_webpack_require__ === 'function') {
                    loaders.unshift(__non_webpack_require__);
                }
                for (const load of loaders) {
                    try {
                        const loaded = load(entry);
                        const ctor = loaded?.default || loaded;
                        if (typeof ctor === 'function') {
                            return new ctor({ owner_id: parent });
                        }
                    } catch (e) {
                        // следующий loader
                    }
                }
            }
            return original.call(this, ext, classId, parent);
        };
        Extensions.log('patched getClassInstance', {
            constructorName: prototype.constructor?.name,
        });
    }

    /**
     * @private
     */
    static wrapKnownPrototypes() {
        const known = Extensions._knownPrototypes;
        if (!known) {
            return;
        }
        for (const prototype of known) {
            Extensions.wrapPrototype(prototype);
        }
    }

    /**
     * @private
     */
    static scheduleWrap(prototype) {
        if (!Extensions._knownPrototypes) {
            Extensions._knownPrototypes = new Set();
        }
        Extensions._knownPrototypes.add(prototype);
        Extensions.wrapPrototype(prototype);

        if (prototype._wrapScheduled) {
            return;
        }
        prototype._wrapScheduled = true;

        const retry = () => Extensions.wrapPrototype(prototype);
        if (typeof process !== 'undefined' && process.nextTick) {
            process.nextTick(retry);
        }
        if (typeof setImmediate === 'function') {
            setImmediate(retry);
        }
        setTimeout(retry, 0);
    }

    /**
     * @private
     */
    extendService() {
        Extensions.scheduleWrap(Object.getPrototypeOf(this));
    }
}

module.exports = Extensions;
