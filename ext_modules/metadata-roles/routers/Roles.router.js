const router = sreda.restmodule.Router();
const Controller = require('../controllers/Roles.controller');
const checkAccess = require('../../middleware-rest-check-access/services/checkAccess.js');

router
    .route('/metadata')
    .get(checkAccess(['Adminpanel', 'MetadataAdmin']), Controller.metadata);
router
    .route('/metadata')
    .post(
        checkAccess(['Adminpanel', 'MetadataAdmin']),
        Controller.createMetadata
    );
router
    .route('/metadata/:id')
    .get(checkAccess(['Adminpanel', 'MetadataAdmin']), Controller.metadataItem);
router
    .route('/metadata/:id')
    .put(
        checkAccess(['Adminpanel', 'MetadataAdmin']),
        Controller.updateMetadata
    );
router
    .route('/metadata/:id')
    .delete(
        checkAccess(['Adminpanel', 'MetadataAdmin']),
        Controller.deleteMetadata
    );

router
    .route('/:id')
    .get(checkAccess(['MetadataDataRead']), Controller.read);
router
    .route('/:id')
    .post(checkAccess(['MetadataDataWrite']), Controller.create);
router
    .route('/:id')
    .put(checkAccess(['MetadataDataWrite']), Controller.update);
router
    .route('/:id')
    .delete(checkAccess(['MetadataDataWrite']), Controller.delete);

module.exports = router;
