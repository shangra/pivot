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

## Почему это работает

CMS грузит модули **по путям на диске**: `ext_modules/<имя>/package.json` → `require('./services/Roles.service')`. Имена файлов, папок и строк в `require(...)` — часть публичного контракта. Если склеить весь проект в один бандл и сжать его целиком, эти пути пропадают или ломаются. Здесь каждый `.js` сжимается **отдельно**, дерево `ext_modules` остаётся тем же, поэтому `npm start` ничего не знает про обфускатор.

Между модулями связь идёт по **стабильным именам**, не по локальным переменным внутри файла:

- `require('./Roles.service')` — путь
- `class RolesService` / `module.exports = RolesService` — конструктор
- `sreda.hooks`, `services.auth` — глобальные реестры CMS
- хуки `RolesService.getClassesMetadata.after` — имя класса + имя метода

Локальные `const tmp`, счётчики циклов, внутренние хелперы можно переименовать. Имена из списка выше — нельзя. Их держит `reservedNames.js`. Неуказанный в `config.cjs` модуль остаётся обычным исходником: обфусцированный `wrapper` вызывает тот же `auth/services/Users.service`, что и до сжатия.

Повторный запуск не сжимает уже сжатый код: оригинал лежит в `.src-cache`, в `ext_modules` снова пишется свежая обфускация с того снимка.

## Какие паттерны используются

**Пер-файл, не пер-проект.** Один проход `javascript-obfuscator` на каждый `.js` / `.cjs` / `.mjs`. Соседние файлы и другие модули не участвуют в графе сжатия. `package.json`, markdown и прочие не-JS копируются как есть.

**Сохранение публичного API (`reservedNames`).** Шаблоны — регулярки. `^require$` — точное имя. `^[A-Za-z_$][\w$]*Service$` — любое `*Service` (RolesService, Users.service-класс и т.д.), чтобы не перечислять каждый модуль. Так же `*Class` и `*Controller`. Плюс ядро: `Extensions`, `MetadataService`, методы дерева (`getClassesMetadata`, `getTreeChildrenV2`, …), id узлов (`Roles`, `Rules`, …), свободные глобалы `sreda`, `services`, `wrapper`, `globalThis`.

**Не трогать глобалы и ключи объектов.** В конфиге обфускатора:

- `renameGlobals: false` — не переименовывать необъявленные `sreda` / `services`
- `transformObjectKeys: false` — не сжимать ключи `{ getClassesMetadata: ... }`, по ним CMS ищет хуки
- `controlFlowFlattening: false`, `deadCodeInjection: false`, `selfDefending: false` — иначе ломаются Node, динамический `require` и отладка

**Только локальные идентификаторы.** `identifierNamesGenerator: 'mangled-shuffled'` — короткие имена внутри файла. Строки (`require`-пути) могут уехать в string array, но в рантайме остаются теми же строками.

**Выборочные модули.** В `ext_modules` сжимаются только папки из `config.cjs`. Остальные файлы CMS читает как раньше. Смешанный режим: часть модулей закрыта, часть открыта для разработки.

**Кэш исходников.** Первый запуск копирует модуль в `obfuscator/.src-cache/<имя>`. Дальше источник — кэш, назначение — `ext_modules/<имя>`. `--restore` копирует кэш обратно.

## Что не копировать

- `obfuscator/.src-cache` — кэш исходников, появляется после первого запуска
- `core/command/buildload/obfuscateModules.js` — старый CLI в `dist-obf`, для этой схемы не нужен
