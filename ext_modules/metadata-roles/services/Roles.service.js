const DefaultMetaObject = require('../../metadata-cmp/services/DefaultMetaObject.service');
const constants = require('../constants');
const RolesClass = require('./metadata/Roles.class');
const MetadataClass = require('../../metadata/services/Metadata.service');
const ApiError = require('../../../core/exceptions/ApiError');
const FormsService = require('../../metadata-forms/services/forms.service');
const Metadata = new MetadataClass();

class RolesService extends DefaultMetaObject {
    constructor() {
        super(__dirname);
        const name = 'Roles';
        this.id = constants[name].id;
        this.component = constants[name].component;
    }

    async form() {
        return {
            form: {
                component: 'MetadataUIKit.Tabs',
                props: {
                    tabs: [
                        {
                            name: 'Реквизиты',
                            content: this.getFormFields(),
                        },
                    ],
                },
            },
        };
    }

    /**
     * Возвращает конфигурацию полей формы в зависимости от типа документа
     * @returns {Array<object>} Массив объектов с конфигурацией полей формы
     */
    getFormFields() {
        const commonFields = [
            {
                name: 'formelement',
                description: 'форма документа',
                type: 'REF',
                useParent: false,
                link: {
                    type: 'local',
                    metalink: [new FormsService().id, new FormsService().id],
                },
            },
            {
                name: 'formlist',
                description: 'форма списка',
                type: 'REF',
                useParent: false,
                link: {
                    type: 'local',
                    metalink: [new FormsService().id, new FormsService().id],
                },
            },
            {
                name: 'formchoice',
                description: 'форма выбора',
                type: 'REF',
                useParent: false,
                link: {
                    type: 'local',
                    metalink: [new FormsService().id, new FormsService().id],
                },
            },
        ];
        return commonFields;
    }

    async createMetadata(body, transaction) {
        const errors = await this.validate(body);
        if (errors.length > 0) {
            const message = Object.values(errors).join('\n');
            throw ApiError.BadRequest(message);
        }
        return super.createMetadata(body, transaction);
    }

    async updateMetadata(id, body, transaction) {
        const errors = await this.validate(body);
        if (errors.length > 0) {
            const message = Object.values(errors).join('\n');
            throw ApiError.BadRequest(message);
        }
        return super.updateMetadata(id, body, transaction);
    }

    async getChildren(id) {
        const pages = await Metadata.getMetadataChildren(id);
        return pages.map((item) => this.convertToNodeType(item));
    }

    /**
     * Преобразование данных страницы в формат NodeType
     */
    convertToNodeType(page) {
        return {
            id: page.id,
            title: page.name,
            children: [],
            loading: false,
            hasChildren: false,
            class: 'pages',
            crud: ['c', 'r', 'u', 'd', 'rls'],
        };
    }

    async create(id, body) {
        return new RolesClass({ id }).create(id, body);
    }

    async read(id, options = {}) {
        return new RolesClass({ id }).read(id, options);
    }

    async update(id, body) {
        return new RolesClass({ id }).update(id, body);
    }

    async delete(id, body) {
        return new RolesClass({ id }).delete(id, body);
    }

    async getTreeChildrenV3(children) {
        return this.hideChildren(children, 'Roles');
    }

    async getTreeChildrenV2(children) {
        const unExtendable = ['Roles'];
        return children.map((child) =>
            unExtendable.includes(child.class)
                ? { ...child, needToLoading: false }
                : child
        );
    }
}

module.exports = RolesService;
