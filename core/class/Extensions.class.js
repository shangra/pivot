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
        const next =
            kind === 'extended'
                ? await hook(result, functionParams, originalMethod)
                : await hook(result);

        return next === undefined ? result : next;
    }

    /**
     * Старый контракт: исходные позиционные args.
     * Новая перегрузка: значения из extArgs, если имена параметров надёжно сняты.
     * @private
     */
    static getSourceArgs(funcParamNames, extArgs, args) {
        const names = (funcParamNames || []).filter(
            (name) =>
                typeof name === 'string' &&
                name &&
                name !== 'this' &&
                /^[A-Za-z_$][\w$]*$/.test(name)
        );

        // В бандле toString() часто без аргументов — Object.values(extArgs) даёт []
        if (!names.length || names.length < args.length) {
            return args;
        }

        return names.map((name, i) =>
            Object.prototype.hasOwnProperty.call(extArgs, name)
                ? extArgs[name]
                : args[i]
        );
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
        let trace = false;
        let result = await functionResult;
        const extFunctionName = `${context.childrenClassName}.${functionName}.${functionState}`;
        if (sreda.hooks[extFunctionName]) {
            const triggers = sreda.hooks[extFunctionName];
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
     * @private
     */
    extendService() {
        const prototype = Object.getPrototypeOf(this);
        const targets = Object.keys(sreda.hooks || {});

        // методы в прототипе перегружаются только 1 раз и после сборки
        if (!prototype._sourceMethods && targets.length) {
            /** @type {Record<string, Function>} */
            prototype._sourceMethods = {};

            const className = this.constructor.name;
            const methods = Object.getOwnPropertyNames(prototype).filter(
                (method) =>
                    method !== 'constructor' &&
                    typeof prototype[method] === 'function' &&
                    targets.find(
                        (target) =>
                            target.replace(
                                /\.(inner|before|after|decorate)$/,
                                ''
                            ) === `${className}.${method}`
                    )
            );
            for (const method of methods) {
                // записываем исходные методы в скрытое поле прототипа
                prototype._sourceMethods[method] = prototype[method];

                // возвращаем новую функцию (this внутри всегда будет у того объекта, на котором вызван метод)

                // т.к. новая функция по определению может быть только в классах, унаследованных от Extensions,
                // у объекта (this) гарантированно будут методы класса Extensions
                prototype[method] = async function (...args) {
                    const source = prototype._sourceMethods[method];
                    const funcParamNames = Extensions.getFuncParamNames(source);
                    const extArgs = Object.fromEntries(
                        funcParamNames.map((name, i) => [name, args[i]])
                    );

                    extArgs.this = this;
                    Object.defineProperty(extArgs, '$args', {
                        value: args,
                        enumerable: false,
                    });

                    let { result, trace } = await Extensions.before(
                        method,
                        undefined,
                        extArgs,
                        this
                    );

                    ({ result, trace } = await Extensions.inner(
                        method,
                        result,
                        extArgs,
                        this
                    ));

                    if (!trace) {
                        ({ result, trace } = await Extensions.decorate(
                            method,
                            result,
                            extArgs,
                            this,
                            source.bind(this)
                        ));

                        if (!trace) {
                            result = await source.apply(
                                this,
                                Extensions.getSourceArgs(
                                    funcParamNames,
                                    extArgs,
                                    args
                                )
                            );
                        }
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
        }
    }
}

module.exports = Extensions;
