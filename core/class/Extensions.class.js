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
     * Старые хуки: hook(result). Новые: hook(result, params, original).
     * Один объект hookParams оставляем вторым аргументом — его читает
     * getClassesMetadata(innerResult, functionParams).
     * @private
     */
    static async invokeHook(hook, result, functionParams, originalMethod, info) {
        if (typeof hook !== 'function') {
            return result;
        }

        const hookThis = functionParams?.this;
        Extensions.log('invokeHook in', {
            hook: hook.name || 'anonymous',
            hookLength: hook.length,
            resultIn: Extensions.dump(result),
            thisId: hookThis?.id,
            thisDirname: hookThis?.dirname,
            thisConstructor: hookThis?.constructor?.name,
            args0: functionParams?.[0],
            argsLength: functionParams?.length,
        });

        const next = await hook(result, functionParams, originalMethod);
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
                    info
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
