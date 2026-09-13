# metadata-roles

Модуль NodeCMS. Управление ролями пользователей: метаданные класса `Roles` и CRUD данных через `auth` (`Users.service`).

Собран по записи экрана `ext_modules/metadata-roles` в `sreda-pivot`. Класть в `ext_modules` рядом с `wrapper`.

## Структура

```
metadata-roles/
├── constants.js
├── controllers/Roles.controller.js
├── routers/Roles.router.js
├── services/Roles.service.js
├── services/metadata/Roles.class.js
├── services/metadata/roles.fields.js
├── index.js
├── package.json
└── README.md
```

## API

Базовый путь: `/metadata/roles`

- `GET/POST /metadata` — метаданные класса
- `GET/PUT/DELETE /metadata/:id` — метаданные элемента
- `GET/POST/PUT/DELETE /:id` — данные ролей (`MetadataDataRead` / `MetadataDataWrite`)

Данные ролей читаются через `AuthUser.getRoles` / `getAllRoles`. Поля: `id`, `code`, `name`, `details`.

## Зависимости NodeCMS

- `metadata-cmp` ~1.5.4
- `auth` ~1.5.0
- `metadata-forms` ~1.5.0
