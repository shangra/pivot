# Обфускатор модулей

Коробка для проекта со структурой `ext_modules/<имя-модуля>`. Указанные модули сжимаются **на месте**, остальные не трогаются. Точка входа не меняется: `npm start`.

## Что куда копировать

Скопируйте **всю папку** `obfuscator` в **корень** рабочего проекта (туда, где уже лежит `ext_modules`), с теми же именами:

| Откуда (этот репозиторий) | Куда (корень проекта, рядом с `ext_modules`) |
|---|---|
| `obfuscator/config.cjs` | `obfuscator/config.cjs` |
| `obfuscator/obfuscate.cjs` | `obfuscator/obfuscate.cjs` |
| `obfuscator/reservedNames.js` | `obfuscator/reservedNames.js` |
| `obfuscator/README.md` | `obfuscator/README.md` |

Корень должен выглядеть так:

```
проект/
  ext_modules/
    wrapper/
    auth/
    ...
  obfuscator/
    config.cjs
    obfuscate.cjs
    reservedNames.js
    README.md
  package.json
```

`javascript-obfuscator` ставить в **корне проекта**, не внутри `obfuscator`:

```bash
npm i -D javascript-obfuscator
```

## Как запускать

1. В `obfuscator/config.cjs` вписать имена папок из `ext_modules`:

```js
modules: [
    'wrapper',
    'auth',
],
```

2. Сжать только эти модули:

```bash
node obfuscator/obfuscate.cjs
```

3. Стартовать как обычно:

```bash
npm start
```

Обфусцированный `wrapper` и обычный `auth` работают вместе: пути `require` и имена файлов не меняются.

Проверка без записи на диск:

```bash
node obfuscator/obfuscate.cjs --dry-run
```

Вернуть исходники указанных модулей:

```bash
node obfuscator/obfuscate.cjs --restore
```

Первый запуск копирует оригиналы в `obfuscator/.src-cache`. Повторный запуск берёт код оттуда, а не уже сжатые файлы.

## Что не копировать

- `obfuscator/.src-cache` — кэш исходников, появляется после первого запуска
- `core/command/buildload/obfuscateModules.js` — старый CLI в `dist-obf`, для этой схемы не нужен
