const User = require("../models/User");
const { get } = require("../utils/axiosUtil");
const Channel = require("../models/channel-model");
const logger = require("../config/logger");

const syncChannels = async (storeHash) => {
  try {
  if (!storeHash) {
    throw new Error("Store hash is missing");
  }

  let sitesList = [];
  let channelsList = [];

  const user = await User.findOne({ store_hash: storeHash })
    .select("access_token primaryDomain _id")
    .lean();
  if (!user) {
    throw new Error(`User not found for -> ${storeHash}`);
  }
  const access_token = user.access_token;
  if (!access_token) {
    throw new Error(`Access token not found for -> ${storeHash}`);
  }

  try {
    const [sitesResponse, channelsResponse] = await Promise.all([
      get(`https://api.bigcommerce.com/stores/${storeHash}/v3/sites`, {
        "X-Auth-Token": access_token,
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      get(`https://api.bigcommerce.com/stores/${storeHash}/v3/channels`, {
        "X-Auth-Token": access_token,
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
    ]);

    sitesList = sitesResponse;
    channelsList = channelsResponse;

    if (sitesList.data.length === 0) {
      logger.error("Sites list not found for -> ", storeHash);
    }
    if (channelsList.data.length === 0) {
      logger.error("Channels list not found for -> ", storeHash);
    }
    logger.info(
      "Sites list found -> ",
      sitesList.data.length,
      "Channels list found -> ",
      channelsList.data.length,
      "User ID -> ",
      user._id,
    );
  } catch (error) {
    if (
      error.config &&
      error.config.url &&
      error.config.url.includes("/v3/sites")
    ) {
      console.error("Error getting sites list", error);
    } else if (
      error.config &&
      error.config.url &&
      error.config.url.includes("/v3/channels")
    ) {
      console.error("Error getting channels list", error);
    } else {
      console.error("Error in parallel API requests", error);
    }
    throw error;
  }

  const sites = sitesList?.data || [];
  const siteMap = new Map();
  sites.forEach((site) => {
    siteMap.set(site.channel_id, site);
  });

  // const channelsToUpsert = channelsList.data.filter(
  //   (c) => c.status === "active" && c.type === "storefront",
  // );
    const channelsToUpsert = channelsList.data

  if (channelsToUpsert.length > 0) {
    
    const normalizedPrimaryDomain = user?.primaryDomain
      ?.replace(/^https?:\/\//, "")
      ?.replace(/^www\./, "");

    // Use bulkWrite for optimal MongoDB upsert performance
    const bulkOps = channelsToUpsert.map((channel) => {
      const site = siteMap.get(channel.id);
      const url = site?.url || null;

      const urlNormalized = url
        ? url.replace(/^https?:\/\//, "").replace(/^www\./, "")
        : "";

      return {
        updateOne: {
          filter: { store_hash: storeHash, channel_id: channel.id },
          update: {
            $set: {
              userId: user._id,
              name: channel.name,
              storefront_url: url,
              type: channel.type,
              status: channel.status,
              isDeleted: false,
              date_created: channel.date_created,
              date_modified: channel.date_modified,
              is_primary:
                normalizedPrimaryDomain &&
                normalizedPrimaryDomain === urlNormalized,
            },
            $setOnInsert: {
              store_hash: storeHash,
              channel_id: channel.id,
            },
          },
          upsert: true,
        },
      };
    });

    if (bulkOps.length > 0) {
      await Channel.bulkWrite(bulkOps);
    }

    logger.info("Channels upserted successfully -> ", channelsToUpsert.length);
  } else {
      logger.error("No channels found for -> ", storeHash);
    }
  } catch (error) {
    console.error("Error syncing channels", error);
    logger.error("Error syncing channels", error);
  }
};


module.exports = {
    syncChannels,
};