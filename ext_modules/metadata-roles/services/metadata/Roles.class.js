const crypto = require('crypto');

/** GLOBAL */
const LevelClass = require('../../../metadata-cmp/services/metadata/source/LevelClass.class');

/** LOCAL */
const constants = require('../../constants');
const { allFieldsGenerator } = require('./roles.fields');

/** AUTH */
const AuthUserClass = require('../../../auth/services/Users.service');
const AuthUser = new AuthUserClass();

class RolesClass extends LevelClass {
    constructor(props) {
        super(props);
        const name = 'Roles';
        this.id = constants[name].id;
        this.component = constants[name].component;
        this.childrenCRUD = ['r', 'u', 'd', 'rls'];

        const openFunction = {
            name: 'openMetadataForm',
            props: {
                id: this.id,
                title: constants[name].name,
                component: constants[name].route,
                server: 'backend',
            },
        };

        this.props = {
            id: props?.id ?? this.id,
            owner_id: this.owner_id,
            class_id: this.id,
            component: this.component,
            name: constants[name].name,
            description: constants[name].description,
            crud: ['u', '*', 'rls'],
            route: constants[name].route,
            parent: props?.parent,
            events: {
                onDoubleClick: openFunction,
            },
        };
        this.props.icon = constants[name].icon ?? null;
    }

    async item(item, options = {}) {
        const menuItem = await super.item(item, options);
        if (this.props.events) {
            menuItem.events = this.props.events;
        }
        return menuItem;
    }

    getFieldIds() {
        return {
            id: '6124ea90-bc85-44ca-bc14-024b21ffd40c',
            code: '3b1d3b6e-f716-4713-9dee-9f66eac4cb56',
            name: '9fc4a273-3cea-4b15-a8e2-f11aa00bb2f4',
            details: '4bd6e52a-fc53-4ec8-aeb2-8700562b892f',
            pkUuid: '6abd6629-fc53-456c-ae0e-8700562b892f',
        };
    }

    async tableInfo() {
        const fieldIds = this.getFieldIds();
        const allFields = allFieldsGenerator(fieldIds);
        const fields = {};
        const fieldsGUID = {};
        const Sysfields = {};
        const SysfieldsGUID = {};
        const Refs = {};
        const KeysGUID = {};

        allFields.forEach((field) => {
            const fieldName = field.settings.namefield;
            fields[fieldName] = {
                field: fieldName,
                name: field.name,
                description: field.description,
                id: field.id,
                increment: field.settings.increment ?? false,
                notnull: field.settings.notnull ?? false,
                type: field.settings.type,
                len: field.settings.len,
                unique: field.settings.unique,
                default: field.settings.default,
                show: field.settings.showfield,
                value: fieldName,
                multitime: false,
                multiefields: [],
                editing: field.settings.editing ?? true,
            };
            fieldsGUID[field.id] = fields[fieldName];
            if (['id', '_id'].includes(fieldName)) {
                Sysfields[fieldName] = fields[fieldName];
                SysfieldsGUID[field.id] = Sysfields[fieldName];
            }
        });

        const pktuid = fieldIds.pkUuid || crypto.randomUUID();
        KeysGUID['PK'] = {
            key: 'PK',
            description: 'Первичный ключ',
            id: pktuid,
            fields: {
                id: {
                    field: 'id',
                    name: 'Идентификатор',
                    description: 'Идентификатор',
                    value: fieldIds.id,
                },
            },
            settings: {
                primarykey: true,
            },
        };

        return {
            fields,
            fieldsGUID,
            Sysfields,
            SysfieldsGUID,
            KeysGUID,
            Refs,
            indexes: {},
            regular: {},
            tabular: {},
            tabularParts: {},
        };
    }

    async read(id, inputOptions = {}) {
        const options = inputOptions;
        const roleId = options.where?.id;
        let roles;
        if (roleId) {
            const ids = Array.isArray(roleId) ? roleId : [roleId];
            roles = await AuthUser.getRoles(ids, options);
        } else {
            roles = await AuthUser.getAllRoles(options);
        }

        const treeObject = await this.tableInfo();
        const cols = Object.values(treeObject.fields);
        const rows = roles.map((role) => {
            const row = {
                ...role,
            };
            for (const field of cols) {
                if (!(field.field in row)) {
                    row[field.field] = null;
                }
            }
            return row;
        });
        const item = await this.item({}, options);
        return {
            rows,
            cols,
            refs: {},
            reffields: {},
            count: roles.length,
            offset: options.offset ?? 0,
            limit: options.limit ?? rows.length,
            options,
            metadata: { ...item, ...treeObject },
        };
    }
}

module.exports = RolesClass;
