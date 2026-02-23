const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { installApp, uninstallApp } = require("../controllers/storeController");

function verifyWebhook(req, res, next) {
  console.log("Verify bigcommerce webhook:--------------- ", req.rawBody);
  try {
    const signature = req.headers["x-bc-signature"];

    const payload = req.rawBody;

    const hmac = crypto
      .createHmac("sha256", process.env.BIG_COMMERCE_CLIENT_SECRET)
      .update(payload)
      .digest("base64");

    if (signature !== hmac) {
      return res.status(401).send("Invalid webhook signature");
    }

    next();
  } catch (err) {
    console.error(err);
    return res.status(401).send("Invalid webhook signature");
  }
}

router.get("/install", installApp);

router.get("/uninstall", uninstallApp);

module.exports = router;
