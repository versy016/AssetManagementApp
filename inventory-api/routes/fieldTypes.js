const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/fieldTypes.controller');

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.post('/ensure-defaults', ctrl.ensureDefaults);

module.exports = router;
