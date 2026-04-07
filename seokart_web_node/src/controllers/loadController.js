const logger = require("../config/logger");
const Channel = require("../models/channel-model");
const { syncChannels } = require("../services/store-service");

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

exports.createAndSyncChannelsWithSites = async (req, res) => {
  try {
    const storeHash = req.query.storeHash;
    console.log("store hash --------------", storeHash);
    if (!storeHash) {
      return res.status(400).json({
        success: false,
        message: "Store hash is missing",
      });
    }
    logger.info(
      "createAndSyncChannelsWithSites called -- by store hash -> ",
      storeHash,
    );
    const userId = req.user.id;

    await syncChannels(storeHash);

    const primaryChannel = await Channel.findOne({
      store_hash: storeHash,
      is_primary: true,
      isDeleted: false,
    });
    
    if (!primaryChannel) {
      return res.status(404).json({
        success: false,
        message: "Primary channel not found",
      });
    }
    logger.info("Primary channel found", primaryChannel);
    return res.status(200).json({
      success: true,
      data: primaryChannel,
    });
  }
  catch (error) {
    logger.error("Error creating and syncing channels with sites", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
