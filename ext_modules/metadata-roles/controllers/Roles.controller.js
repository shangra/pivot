const RolesServiceClass = require('../services/Roles.service');
const RolesService = new RolesServiceClass();

/**
 * @swagger
 * tags:
 *   - name: Roles
 *     description: Управление ролями пользователей
 */
class RolesController {
    /**
     * @swagger
     * /roles/metadata:
     *   get:
     *     summary: Получить метаданные ролей
     *     tags: [Roles]
     *     security:
     *       - Adminpanel: []
     *       - MetadataAdmin: []
     *     responses:
     *       200:
     *         description: Метаданные ролей
     */
    static async metadata(req, res, next) {
        try {
            const form = await RolesService.metadata();
            res.json(form);
        } catch (e) {
            next(e);
        }
    }

    /**
     * @swagger
     * /roles/metadata/{id}:
     *   get:
     *     summary: Получить метаданные конкретной роли
     *     tags: [Roles]
     *     security:
     *       - Adminpanel: []
     *       - MetadataAdmin: []
     *     parameters:
     *       - name: id
     *         description: ID роли
     *         in: path
     *         required: true
     *         type: integer
     *     responses:
     *       200:
     *         description: Метаданные конкретной роли
     */
    static async metadataItem(req, res, next) {
        try {
            const { id } = req.params;
            const form = await RolesService.metadataItem(id);
            res.json(form);
        } catch (e) {
            next(e);
        }
    }

    /**
     * @swagger
     * /roles/metadata:
     *   post:
     *     summary: Создать новые метаданные роли
     *     tags: [Roles]
     *     security:
     *       - Adminpanel: []
     *       - MetadataAdmin: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *     responses:
     *       200:
     *         description: Новые метаданные роли
     */
    static async createMetadata(req, res, next) {
        try {
            const body = req.body;
            const form = await RolesService.createMetadata(body);
            res.json(form);
        } catch (e) {
            next(e);
        }
    }

    /**
     * @swagger
     * /roles/metadata/{id}:
     *   put:
     *     summary: Обновить метаданные роли
     *     tags: [Roles]
     *     security:
     *       - Adminpanel: []
     *       - MetadataAdmin: []
     *     parameters:
     *       - name: id
     *         description: ID роли
     *         in: path
     *         required: true
     *         type: integer
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *     responses:
     *       200:
     *         description: Обновлённые метаданные роли
     */
    static async updateMetadata(req, res, next) {
        try {
            const { id } = req.params;
            const body = req.body;
            const form = await RolesService.updateMetadata(id, body);
            res.json(form);
        } catch (e) {
            next(e);
        }
    }

    /**
     * @swagger
     * /roles/metadata/{id}:
     *   delete:
     *     summary: Удалить метаданные роли
     *     tags: [Roles]
     *     security:
     *       - Adminpanel: []
     *       - MetadataAdmin: []
     *     parameters:
     *       - name: id
     *         description: ID роли
     *         in: path
     *         required: true
     *         type: integer
     *     responses:
     *       200:
     *         description: Результат удаления метаданных роли
     */
    static async deleteMetadata(req, res, next) {
        try {
            const { id } = req.params;
            const form = await RolesService.deleteMetadata(id);
            res.json(form);
        } catch (e) {
            next(e);
        }
    }

    /**
     * @swagger
     * /roles/{id}:
     *   post:
     *     summary: Создать новую роль пользователя
     *     tags: [Roles]
     *     security:
     *       - MetadataDataWrite: []
     *     parameters:
     *       - name: id
     *         description: ID роли
     *         in: path
     *         required: true
     *         type: integer
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               name:
     *                 type: string
     *               permissions:
     *                 type: array
     *                 items:
     *                   type: string
     *     responses:
     *       200:
     *         description: Новая роль пользователя
     */
    static async create(req, res, next) {
        try {
            const { id } = req.params;
            const body = req.body;
            const metadata = await RolesService.create(id, body);
            res.json(metadata);
        } catch (e) {
            next(e);
        }
    }

    /**
     * @swagger
     * /roles/{id}:
     *   get:
     *     summary: Прочитать роль пользователя
     *     tags: [Roles]
     *     security:
     *       - MetadataDataRead: []
     *     parameters:
     *       - name: id
     *         description: ID роли
     *         in: path
     *         required: true
     *         type: integer
     *     responses:
     *       200:
     *         description: Роль пользователя
     */
    static async read(req, res, next) {
        try {
            const { id } = req.params;
            const options = req.query.options ?? {};
            const metadata = await RolesService.read(id, options);
            res.json(metadata);
        } catch (e) {
            next(e);
        }
    }

    /**
     * @swagger
     * /roles/{id}:
     *   put:
     *     summary: Обновить роль пользователя
     *     tags: [Roles]
     *     security:
     *       - MetadataDataWrite: []
     *     parameters:
     *       - name: id
     *         description: ID роли
     *         in: path
     *         required: true
     *         type: integer
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               name:
     *                 type: string
     *               permissions:
     *                 type: array
     *                 items:
     *                   type: string
     *     responses:
     *       200:
     *         description: Обновлённая роль пользователя
     */
    static async update(req, res, next) {
        try {
            const { id } = req.params;
            const body = req.body;
            const metadata = await RolesService.update(id, body);
            res.json(metadata);
        } catch (e) {
            next(e);
        }
    }

    /**
     * @swagger
     * /roles/{id}:
     *   delete:
     *     summary: Удалить роль пользователя
     *     tags: [Roles]
     *     security:
     *       - MetadataDataWrite: []
     *     parameters:
     *       - name: id
     *         description: ID роли
     *         in: path
     *         required: true
     *         type: integer
     *     responses:
     *       200:
     *         description: Результат удаления роли пользователя
     */
    static async delete(req, res, next) {
        try {
            const { id } = req.params;
            const body = req.body;
            const metadata = await RolesService.delete(id, body);
            res.json(metadata);
        } catch (e) {
            next(e);
        }
    }
}

module.exports = RolesController;
