const express = require('express');
const router = express.Router();
const backlinkController = require('../controllers/backlinkController');
const { auth } = require('../middleware/authMiddleware');

router.get(
  '/dashboard',
  auth,
  backlinkController.getBacklinkDataForDashboard
);

router.get(
  '/sync',
  auth,
  backlinkController.syncBacklinkData
);
module.exports = router;