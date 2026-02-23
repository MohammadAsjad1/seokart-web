const { post, get } = require("../utils/axiosUtil");
const User = require("../models/User");
const jwt = require("jsonwebtoken");

exports.installApp = async (req, res) => {
  const { code, context, scope } = req.query;

  console.log("[STORE-CONTROLLER] installApp called ------ ");
  
  // Validate required query parameters
  if (!code || !context || !scope) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters: code, context, and scope are required"
    });
  }

  try {
    const data = await post("https://login.bigcommerce.com/oauth2/token", {
      client_id: process.env.BIG_COMMERCE_CLIENT_ID,
      client_secret: process.env.BIG_COMMERCE_CLIENT_SECRET,
      redirect_uri: `${process.env.BASE_URL}/store/install`,
      grant_type: "authorization_code",
      code,
      scope,
      context,
    });

    const { access_token, user, context: storeHashData } = data;
    const storeHash = storeHashData.replace("stores/", "");

    const storeInfo = await get(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/store`,
      { "X-Auth-Token": access_token }
    );

    const updatePayload = {
      access_token,
      lastInstalledAt: new Date(),
      installStatus: "installed",
      scope,
      email: user.email,
      username: `${storeInfo.first_name || ""} ${storeInfo.last_name || ""}`.trim(),
    };

    await User.findOneAndUpdate(
      { store_hash: storeHash },
      {
        $set: updatePayload,
        $setOnInsert: {
          provider: "bigcommerce",
          store_hash: storeHash,
          store_id: storeInfo.id,
        },
      },
      { upsert: true }
    );
    console.log("[STORE-CONTROLLER] app installed successfully ------ ", storeInfo.name);
    console.log("[STORE-CONTROLLER] Redirecting to BigCommerce dashboard ------ ", `https://store-${storeHash}.mybigcommerce.com/manage/app/${process.env.BIG_COMMERCE_APP_ID}`);

    //  Redirect to BigCommerce dashboard
    return res.redirect(
       `https://store-${storeHash}.mybigcommerce.com/manage/app/${process.env.BIG_COMMERCE_APP_ID}`
    );
  } catch (err) {
    console.error("[STORE-CONTROLLER] Install app failed:", {
      message: err.message,
      status: err.response?.status,
      storeHash: req.query.context?.replace("stores/", "") || "unknown"
    });
    
    // Handle specific error cases
    if (err.response?.status === 400 || err.response?.status === 401) {
      return res.status(err.response.status).json({
        success: false,
        message: "Invalid OAuth credentials or authorization code",
        error: process.env.NODE_ENV === "development" ? err.message : undefined
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to install app. Please try again.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
};

exports.uninstallApp = async (req, res) => {
  const { signed_payload_jwt } = req.query;

  if (!signed_payload_jwt) {
    return res.status(400).send("Missing signed_payload_jwt");
  }

  try {
    // Verify JWT
    const payload = jwt.verify(
      signed_payload_jwt,
      process.env.BIG_COMMERCE_CLIENT_SECRET,
      { algorithms: ["HS256"] }
    );

    // Extract store hash
    const storeHash = payload.sub.replace("stores/", "");

    await User.findOneAndUpdate(
      { store_hash: storeHash },
      {
        installStatus: "uninstalled",
        lastUninstalledAt: new Date(),
        access_token: null,
      }
    );

    res.status(200).clearCookie("token").send("OK");
  } catch (err) {
    console.error("JWT uninstall failed:", err);
    res.status(401).send("Invalid JWT");
  }
};
