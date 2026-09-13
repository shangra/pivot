class Extensions {
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
     * Имена класса, которые ещё видны после сборки.
     * constructor.name в бандле часто становится "t"/"n", а в toString
     * ещё может остаться исходное `class MetadataService`.
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
            // toString недоступен — оставляем constructor.name
        }
        return [...new Set(names.filter(Boolean))];
    }

    /**
     * Ключи sreda.hooks для метода: сначала точное имя класса,
     * затем запасной поиск по суффиксу Method.state (если имя сжали).
     * @private
     */
    static resolveHookKeys(context, functionName, functionState) {
        const hooks = sreda.hooks || {};
        const names = Extensions.getConstructorNames(
            context?.constructor,
            Object.getPrototypeOf(context)
        );
        if (context?.childrenClassName) {
            names.unshift(context.childrenClassName);
        }

        const keys = [];
        const seen = new Set();
        for (const name of names) {
            const key = `${name}.${functionName}.${functionState}`;
            if (!seen.has(key) && hooks[key]) {
                seen.add(key);
                keys.push(key);
            }
        }

        if (!keys.length) {
            const suffix = `.${functionName}.${functionState}`;
            for (const key of Object.keys(hooks)) {
                if (!key.endsWith(suffix) || seen.has(key)) {
                    continue;
                }
                const classPart = key.slice(0, key.length - suffix.length);
                if (classPart && !classPart.includes('.')) {
                    seen.add(key);
                    keys.push(key);
                }
            }
        }

        return keys;
    }

    /**
     * Различает исходный Extensions и новые перегрузки.
     *
     * legacy — модули под старый класс: after-хук получает только результат
     *          исходного метода, например getTreeChildrenV2(children).
     * extended — новые хуки: (innerResult, functionParams[, originalMethod]),
     *            стадии before / inner / decorate.
     *
     * Явный флаг: trigger.info.contract = 'legacy' | 'extended'
     * @private
     * @param {Function} hook
     * @param {string} [functionState]
     * @param {object} [info]
     * @returns {'legacy'|'extended'}
     */
    static getHookKind(hook, functionState, info) {
        const forced = info?.contract || info?.kind;
        if (forced === 'legacy' || forced === 'extended') {
            return forced;
        }
        if (info?.legacy === true) {
            return 'legacy';
        }
        if (info?.extended === true) {
            return 'extended';
        }

        if (
            functionState === 'before' ||
            functionState === 'inner' ||
            functionState === 'decorate'
        ) {
            return 'extended';
        }

        if (typeof hook !== 'function') {
            return 'legacy';
        }

        const names = Extensions.getFuncParamNames(hook);
        const arity = hook.length;
        const source = Extensions.getFunctionSource(hook);
        const extendedMarks = [
            'functionParams',
            'originalMethod',
            'innerResult',
            'extArgs',
        ];

        if (extendedMarks.some((mark) => names.includes(mark))) {
            return 'extended';
        }
        if (extendedMarks.some((mark) => source.includes(mark))) {
            return 'extended';
        }
        if (arity >= 2) {
            return 'extended';
        }

        return 'legacy';
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
     * После бандла hook.length и toString часто врут (Babel переписывает
     * сигнатуру в arguments). Лишние аргументы старые хуки игнорируют,
     * поэтому в бандле всегда передаём полный набор.
     * @private
     */
    static async invokeHook(
        hook,
        result,
        functionParams,
        originalMethod,
        functionState,
        info
    ) {
        if (typeof hook !== 'function') {
            return result;
        }

        const kind = Extensions.getHookKind(hook, functionState, info);
        const bundled = Extensions.getFuncParamNames(hook).length === 0;
        const next =
            kind === 'extended' || bundled
                ? await hook(result, functionParams, originalMethod)
                : await hook(result);

        return next === undefined ? result : next;
    }

    /**
     * @private
     * @param {string} functionName
     * @param {object} functionState
     * @param {object} functionResult
     * @param {object} functionParams
     * @param {object} context
     * @param {Function} [originalMethod]
     */
    static async hook(
        functionName,
        functionState,
        functionResult,
        functionParams,
        context,
        originalMethod
    ) {
        Extensions.wrapKnownPrototypes();

        let trace = false;
        let result = await functionResult;
        const hookKeys = Extensions.resolveHookKeys(
            context,
            functionName,
            functionState
        );

        for (const extFunctionName of hookKeys) {
            const triggers = sreda.hooks[extFunctionName];
            if (!triggers) {
                continue;
            }
            for (const trigger of triggers) {
                const { info, hook } = trigger;
                // триггер выполняется один раз, и удаляется из памяти
                if (info.once) {
                    sreda.hooks[extFunctionName] = sreda.hooks[
                        extFunctionName
                    ].filter((globalTrigger) => globalTrigger !== trigger);
                }
                try {
                    result = await Extensions.invokeHook(
                        hook,
                        result,
                        functionParams,
                        originalMethod,
                        functionState,
                        info
                    );
                    trace = true;
                } catch (e) {
                    if (info.once) {
                        // если произошла ошибка при выполнении триггера, возвращаем его в память, так как он не выполнился
                        sreda.hooks[extFunctionName].push(trigger);
                    }
                    throw e;
                }
            }
        }

        return { trace, result };
    }

    /**
     * @private
     * @param {string} functionName
     * @param {any} functionResult
     * @param {object} functionParams
     * @param {object} context
     * @returns {Promise<{ trace: boolean, result: any }>}
     */
    static async before(functionName, functionResult, functionParams, context) {
        return this.hook(
            functionName,
            context.STATE.before,
            functionResult,
            functionParams,
            context
        );
    }

    /**
     * @private
     * @param {string} functionName
     * @param {object} functionResult
     * @param {object} functionParams
     * @param {object} context
     * @returns {Promise<{ trace: boolean, result: any }>}
     */
    static async inner(functionName, functionResult, functionParams, context) {
        return this.hook(
            functionName,
            context.STATE.inner,
            functionResult,
            functionParams,
            context
        );
    }

    /**
     * @private
     * @param {string} functionName
     * @param {object} functionResult
     * @param {object} functionParams
     * @param {object} context
     * @returns {Promise<{ trace: boolean, result: any }>}
     */
    static async after(functionName, functionResult, functionParams, context) {
        return this.hook(
            functionName,
            context.STATE.after,
            functionResult,
            functionParams,
            context
        );
    }

    /**
     * @private
     * @param {string} functionName
     * @param {object} functionResult
     * @param {object} functionParams
     * @param {object} context
     * @returns {Promise<{ trace: boolean, result: any }>}
     */
    static async decorate(
        functionName,
        functionResult,
        functionParams,
        context,
        originalMethod
    ) {
        return this.hook(
            functionName,
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
    static getFuncParamNames(func) {
        if (typeof func !== 'function') {
            return [];
        }

        const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/gm;
        const ARGUMENT_NAMES = /(?:\.{3})?([A-Za-z_$][\w$]*)/;
        const fnStr = func.toString().replace(STRIP_COMMENTS, '');

        if (fnStr.includes('[native code]')) {
            return [];
        }

        const fnArgs = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')'));
        return fnArgs
            ? fnArgs
                  .split(',')
                  .map((arg) => {
                      const matched = arg.trim().match(ARGUMENT_NAMES);
                      return matched ? matched[1] : null;
                  })
                  .filter(Boolean)
            : [];
    }

    /**
     * Собирает extArgs и по именам, и по позиции: после Babel сигнатура
     * метода часто пустая, а аргументы лежат в arguments / rest.
     * @private
     */
    static buildExtArgs(source, args, instance) {
        const funcParamNames = Extensions.getFuncParamNames(source);
        const extArgs = Object.fromEntries(
            funcParamNames.map((name, i) => [name, args[i]])
        );

        args.forEach((value, i) => {
            if (extArgs[i] === undefined) {
                extArgs[i] = value;
            }
        });

        extArgs.this = instance;
        Object.defineProperty(extArgs, '$args', {
            value: args,
            enumerable: false,
        });
        return extArgs;
    }

    /**
     * @private
     */
    static createWrapper(prototype, method) {
        return async function (...args) {
            Extensions.wrapKnownPrototypes();

            const source = prototype._sourceMethods[method];
            const extArgs = Extensions.buildExtArgs(source, args, this);

            let { result } = await Extensions.before(
                method,
                undefined,
                extArgs,
                this
            );

            ({ result } = await Extensions.inner(
                method,
                result,
                extArgs,
                this
            ));

            // decorate может заменить метод; before/inner исходный вызов не отменяют
            const decorated = await Extensions.decorate(
                method,
                result,
                extArgs,
                this,
                source.bind(this)
            );

            if (decorated.trace) {
                result = decorated.result;
            } else {
                result = await source.apply(this, args);
            }

            ({ result } = await Extensions.after(
                method,
                result,
                extArgs,
                this
            ));

            return result;
        };
    }

    /**
     * Обёртка идемпотентна: в бандле хуки часто появляются позже первого
     * `new MetadataService()`, поэтому прототип дооборачивается позже.
     * @private
     */
    static wrapPrototype(prototype) {
        if (!prototype || prototype === Object.prototype) {
            return;
        }

        const targets = Object.keys(sreda.hooks || {});
        if (!targets.length) {
            return;
        }

        const classNames = Extensions.getConstructorNames(
            prototype.constructor,
            prototype
        );
        if (!prototype._sourceMethods) {
            prototype._sourceMethods = {};
        }

        const methods = Object.getOwnPropertyNames(prototype).filter(
            (method) =>
                method !== 'constructor' &&
                typeof prototype[method] === 'function'
        );

        for (const method of methods) {
            if (prototype._sourceMethods[method]) {
                continue;
            }

            const hookClass = classNames.find((name) =>
                targets.some(
                    (target) =>
                        target.replace(
                            /\.(inner|before|after|decorate)$/,
                            ''
                        ) === `${name}.${method}`
                )
            );
            if (!hookClass) {
                continue;
            }

            if (!prototype._hookClassName) {
                prototype._hookClassName = hookClass;
            }
            prototype._sourceMethods[method] = prototype[method];
            prototype[method] = Extensions.createWrapper(prototype, method);
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
