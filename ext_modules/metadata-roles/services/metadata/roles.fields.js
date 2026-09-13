const allFieldsGenerator = (fieldIds) => [
    {
        id: fieldIds.id,
        name: 'Идентификатор',
        description: 'Идентификатор',
        settings: {
            namefield: 'id',
            type: 'uuid',
            notnull: true,
            unique: true,
            default: 'UUID',
            showfield: false,
            editing: false,
        },
    },
    {
        id: fieldIds.code,
        name: 'Код',
        description: 'Код',
        settings: {
            namefield: 'code',
            type: 'string',
            notnull: true,
            unique: true,
            showfield: true,
        },
    },
    {
        id: fieldIds.name,
        name: 'Имя',
        description: 'Имя',
        settings: {
            namefield: 'name',
            type: 'string',
            notnull: true,
            unique: true,
            showfield: true,
        },
    },
    {
        id: fieldIds.details,
        name: 'Подробности',
        description: 'Подробности',
        settings: {
            namefield: 'details',
            type: 'string',
            showfield: true,
        },
    },
];

module.exports = { allFieldsGenerator };
