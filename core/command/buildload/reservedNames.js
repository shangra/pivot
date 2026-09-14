/**
 * reservedNames для javascript-obfuscator.
 *
 * Подключение в obfuscateBundle.js:
 *
 *   const reservedNames = require('./reservedNames');
 *   const obfuscatorConfig = {
 *       identifierNamesGenerator: 'mangled-shuffled',
 *       reservedNames,
 *       // ...
 *   };
 *
 * Шаблоны — регулярки. `^Name$` = точное имя.
 * `^[A-Za-z_$][\\w$]*Service$` = любое имя, которое заканчивается на Service
 * (CubesService, GuideService, FormsService, …), чтобы не перечислять каждый модуль.
 */
module.exports = [
    // Node / бандл
    '^require$',
    '^process$',
    '^module$',
    '^exports$',
    '^console$',
    '^Buffer$',
    '^global$',
    '^__dirname$',
    '^__filename$',
    '^__non_webpack_require__$',

    // Все *Service и *Class — иначе после обфускации останутся только зарезервированные
    '^[A-Za-z_$][\\w$]*Service$',
    '^[A-Za-z_$][\\w$]*Class$',
    '^[A-Za-z_$][\\w$]*Controller$',

    // Ядро хуков и метаданных
    '^Extensions$',
    '^DefaultMetaObject$',
    '^MetadataService$',
    '^LevelClass$',

    // Методы, по которым ищутся хуки и файлы
    '^getClassesMetadata$',
    '^getTreeChildrenV2$',
    '^getTreeChildrenV3$',
    '^getTreeChildren$',
    '^getClassInstance$',
    '^getMetadatasV3$',
    '^getMetadatasV2$',
    '^hideChildren$',
    '^extendService$',
    '^wrapPrototype$',
    '^childrenClassName$',
    '^_hookClassName$',
    '^_sourceMethods$',

    // Узлы дерева / id модулей (строки child.class)
    '^Roles$',
    '^Rules$',
    '^Rls$',
    '^Guide$',
    '^Guides$',
    '^Cubes$',
    '^Reports$',
    '^Enums$',
    '^Forms$',
    '^Connector$',
    '^Connectors$',
    '^Infoservice$',
    '^InfoserviceGuide$',
    '^InfoserviceMatrixGuide$',

    // Явные сервисы на случай, если общий шаблон *Service не сработает
    '^RolesService$',
    '^RulesService$',
    '^RlsService$',
    '^GuideService$',
    '^GuidesService$',
    '^CubesService$',
    '^ReportsService$',
    '^EnumsService$',
    '^FormsService$',
    '^ConnectorService$',
    '^ConnectorsService$',
    '^InfoserviceService$',
    '^InfoserviceGuideService$',
    '^InfoserviceMatrixGuideService$',
];
