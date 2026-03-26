const { post, get } = require("../utils/axiosUtil");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const logger = require("../config/logger");
const Channel = require("../models/channel-model");

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
console.log("starting to get token...")
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

   let storeInfo = null;
   try {
     storeInfo = await get(
       `https://api.bigcommerce.com/stores/${storeHash}/v2/store`,
       {
         "X-Auth-Token": access_token,
         "Accept": "application/json",
         "Content-Type": "application/json"
       }
     );
     console.log("store info found...")
   } catch (error) {
    console.error("Error getting store info", error)
    throw error;
   }

    const updatePayload = {
      access_token,
      lastInstalledAt: new Date(),
      installStatus: "installed",
      scope,
      email: user.email,
      username: `${storeInfo?.first_name || ""} ${storeInfo?.last_name || ""}`.trim(),
      primaryDomain: storeInfo.domain,
    };

    console.log("updating user... ")
    const updatedUser = await User.findOneAndUpdate(
      { store_hash: storeHash },
      {
        $set: updatePayload,
        $setOnInsert: {
          provider: "bigcommerce",
          store_hash: storeHash,
          store_id: storeInfo?.id,
        },
      },
      { upsert: true, new: true }
    );

    let sitesList = [];
    let channelsList = [];

    try {
      const [sitesResponse, channelsResponse] = await Promise.all([
        get(
          `https://api.bigcommerce.com/stores/${storeHash}/v3/sites`,
          {
            "X-Auth-Token": access_token,
            "Accept": "application/json",
            "Content-Type": "application/json"
          }
        ),
        get(
          `https://api.bigcommerce.com/stores/${storeHash}/v3/channels`,
          {
            "X-Auth-Token": access_token,
            "Accept": "application/json",
            "Content-Type": "application/json"
          }
        )
      ]);

      sitesList = sitesResponse;
      channelsList = channelsResponse;

      console.log("sites list found...", sitesList);
      console.log("channels list found...", channelsList);
    } catch (error) {
      if (error.config && error.config.url && error.config.url.includes('/v3/sites')) {
        console.error("Error getting sites list", error);
      } else if (error.config && error.config.url && error.config.url.includes('/v3/channels')) {
        console.error("Error getting channels list", error);
      } else {
        console.error("Error in parallel API requests", error);
      }
      throw error;
    }

    const sites = sitesList?.data || [];
    const siteMap = new Map();
    sites.forEach(site => {
      siteMap.set(site.channel_id, site);
    });

    const channelsToUpsert = channelsList.data.filter(
      (c) => c.status === "active" && c.type === "storefront"
    );
    
    if (channelsToUpsert.length > 0) {
      await Promise.all(
        channelsToUpsert.map(channel => {
          const site = siteMap.get(channel.id);
          const url = site?.url || null;
    
          return Channel.findOneAndUpdate(
            { store_hash: storeHash, channel_id: channel.id },
            {
              $set: {
                userId: updatedUser._id,
                name: channel.name,
                storefront_url: url, 
                type: channel.type,
                status: channel.status,
                isDeleted: false,
                date_created: channel.date_created,
                date_modified: channel.date_modified,
                is_primary: storeInfo?.secure_url === url || false,
              },
              $setOnInsert: {
                store_hash: storeHash,
                channel_id: channel.id,
              }
            },
            { upsert: true, new: true }
          );
        })
      );
    
      console.log("channels upserted successfully...", channelsToUpsert.length);
    } else {
      console.log("no channels found...");
    }

    console.log("[STORE-CONTROLLER] app installed successfully ------ ", storeInfo.name);
    console.log("[STORE-CONTROLLER] Redirecting to BigCommerce dashboard ------ ", `https://store-${storeHash}.mybigcommerce.com/manage/app/${process.env.BIG_COMMERCE_APP_ID}`);

    console.log(`https://store-${storeHash}.mybigcommerce.com/manage/app/${process.env.BIG_COMMERCE_APP_ID}`)
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

exports.getChannelsList = async (req, res) => {
   try {
    const { storeHash } = req.params;
    const userId = req.user.id;

    const channelsList = await Channel.find({
      store_hash: storeHash,
      userId: userId,
      isDeleted: false,
    });

    if (!channelsList || channelsList.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Channels list not found",
      });
    }

    logger.info("Channels list found", channelsList.length);
    return res.status(200).json({
      success: true,
      data: channelsList,
    });
   } catch (error) {
    logger.error("Error getting channels list", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
   }
};

exports.getFirstChannel = async (req, res) => {
  try {
    const { storeHash } = req.params;
    const userId = req.user.id;
  
   const firstChannel = await Channel.findOne({
    store_hash: storeHash,
    userId: userId,
    isDeleted: false,
   }).sort({ createdAt: 1 });
   if (!firstChannel) {
    return res.status(404).json({
      success: false,
      message: "First channel not found",
    });
   }
   logger.info("First channel found", firstChannel);
   return res.status(200).json({
    success: true,
    data: firstChannel,
   });
  } catch (error) {
    logger.error("Error getting first channel", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};