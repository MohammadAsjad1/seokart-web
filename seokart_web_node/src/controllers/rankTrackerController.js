const {
  Keyword,
  Competitor,
  MonthlyRanking,
  SerpSnapshot,
  RankTrackerActivity,
  KeywordSuggestion,
  CompetitorSuggestion,
  Task,
  MonthlyAiData,
  AiModeTask,
} = require("../models/rankTracker");
const { UserPlan } = require("../models/userPlan");
const RankTrackerService = require("../services/rankTrackerService");
const axios = require("axios");
const mongoose = require("mongoose");

class CustomRankTrackerController {
  constructor() {
    this.rankTrackerService = new RankTrackerService();
  }

  calculateNextMonthlyCheck() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    nextMonth.setHours(2, 0, 0, 0);
    return nextMonth;
  }

  // ========== KEYWORD MANAGEMENT ==========

  async addKeyword(req, res) {
    try {
      const userId = req.user.id;
      const {
        keyword,
        targetDomain,
        location,
        device,
        language,
        searchEngine,
        tags,
      } = req.body;

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: "User plan not found",
        });
      }

      if (userPlan.hasReachedRankTrackerLimit("keywords")) {
        return res.status(400).json({
          success: false,
          message: "Keyword limit reached for current plan",
          data: {
            current: userPlan.rankTracker.usage.keywordsUsed,
            limit: userPlan.rankTracker.limits.keywords,
          },
        });
      }

      const existingKeyword = await Keyword.findOne({
        userId,
        keyword: keyword.toLowerCase().trim(),
        targetDomain: targetDomain.toLowerCase().trim(),
        location,
        device,
        language,
        searchEngine,
      });

      if (existingKeyword) {
        return res.status(400).json({
          success: false,
          message: "Keyword already exists for this domain",
        });
      }

      const newKeyword = new Keyword({
        userId,
        keyword: keyword.trim(),
        targetDomain: targetDomain.toLowerCase().trim(),
        location: location || "United States",
        device: device || "desktop",
        language: language || "en",
        searchEngine: searchEngine || "google",
        updateFrequency: userPlan.rankTracker.limits.updateFrequency,
        tags: tags || [],
        nextScheduledCheck: this.calculateNextMonthlyCheck(),
      });

      await newKeyword.save();
      await userPlan.incrementUsage("rankTracker", "keywords", 1);

      try {
        await this.updateKeywordSuggestionFlag(targetDomain, keyword, true);
      } catch (flagError) {
        console.error("Error updating keyword suggestion flag:", flagError);
      }

      try {
        await this.rankTrackerService.createSerpTask({
          keywordId: newKeyword._id,
          keyword: newKeyword.keyword,
          location: newKeyword.location,
          device: newKeyword.device,
          targetDomain: newKeyword.targetDomain,
          userId,
        });
      } catch (serpError) {
        console.error("Error creating SERP task:", serpError);
      }

      await RankTrackerActivity.create({
        userId,
        action: "keyword_added",
        details: {
          keyword: newKeyword.keyword,
          domain: newKeyword.targetDomain,
        },
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
          source: "web",
        },
      });

      res.status(201).json({
        success: true,
        message: "Keyword added successfully",
        data: {
          id: newKeyword._id,
          keyword: newKeyword.keyword,
          targetDomain: newKeyword.targetDomain,
          location: newKeyword.location,
          device: newKeyword.device,
          tags: newKeyword.tags,
          createdAt: newKeyword.createdAt,
        },
      });
    } catch (error) {
      console.error("Error adding keyword:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async removeKeyword(req, res) {
    try {
      const { keywordId } = req.params;
      const userId = req.user.id;

      const keyword = await Keyword.findOne({ _id: keywordId, userId });
      if (!keyword) {
        return res.status(404).json({
          success: false,
          message: "Keyword not found",
        });
      }

      const keywordDetails = {
        keyword: keyword.keyword,
        targetDomain: keyword.targetDomain,
      };

      // await Keyword.findByIdAndDelete(keywordId);
      // await MonthlyRanking.deleteMany({ keywordId, userId });
      // await Task.deleteOne({ keywordId, userId });
      // await AiModeTask.deleteOne({ keywordId, userId });
      // await MonthlyAiData.deleteMany({ keywordId, userId });
      await Promise.all([
        Keyword.findByIdAndDelete(keywordId),
        MonthlyRanking.deleteMany({ keywordId, userId }),
        Task.deleteOne({ keywordId, userId }),
        AiModeTask.deleteOne({ keywordId, userId }),
        MonthlyAiData.deleteMany({ keywordId, userId }),
      ]);

      try {
        await this.updateKeywordSuggestionFlag(
          keywordDetails.targetDomain,
          keywordDetails.keyword,
          false
        );
      } catch (flagError) {
        console.error("Error updating keyword suggestion flag:", flagError);
      }

      await RankTrackerActivity.create({
        userId,
        action: "keyword_removed",
        details: {
          keyword: keywordDetails.keyword,
          domain: keywordDetails.targetDomain,
        },
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
          source: "web",
        },
      });

      res.status(200).json({
        success: true,
        message: "Keyword removed successfully",
      });
    } catch (error) {
      console.error("Error removing keyword:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async removeMultipleKeywords(req, res) {
    try {
      const { keywordIds } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(keywordIds) || keywordIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No keyword IDs provided",
        });
      }

      const keywords = await Keyword.find({ _id: { $in: keywordIds }, userId });

      if (keywords.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No matching keywords found",
        });
      }

      const keywordDetailsList = keywords.map((k) => ({
        keywordId: k._id,
        keyword: k.keyword,
        targetDomain: k.targetDomain,
      }));

      const idsToDelete = keywordDetailsList.map((k) => k.keywordId);

      await Keyword.deleteMany({ _id: { $in: idsToDelete }, userId });
      await MonthlyRanking.deleteMany({
        keywordId: { $in: idsToDelete },
        userId,
      });
      await Task.deleteMany({ keywordId: { $in: idsToDelete }, userId });
      await AiModeTask.deleteMany({ keywordId: { $in: idsToDelete }, userId });
      await MonthlyAiData.deleteMany({
        keywordId: { $in: idsToDelete },
        userId,
      });

      for (const { keyword, targetDomain } of keywordDetailsList) {
        try {
          await this.updateKeywordSuggestionFlag(targetDomain, keyword, false);
        } catch (flagError) {
          console.error(`Failed to update flag for ${keyword}:`, flagError);
        }
      }

      const activityLogs = keywordDetailsList.map((detail) => ({
        userId,
        action: "keyword_removed",
        details: {
          keyword: detail.keyword,
          domain: detail.targetDomain,
        },
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
          source: "web",
        },
      }));

      await RankTrackerActivity.insertMany(activityLogs);

      res.status(200).json({
        success: true,
        message: "Keywords removed successfully",
        removedCount: keywordDetailsList.length,
      });
    } catch (error) {
      console.error("Error removing multiple keywords:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async getAddedKeywords(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10, search } = req.query;

      const query = { userId, isActive: true };

      if (search) {
        query.$or = [
          { keyword: { $regex: search, $options: "i" } },
          { targetDomain: { $regex: search, $options: "i" } },
          { tags: { $in: [new RegExp(search, "i")] } },
        ];
      }

      const keywords = await Keyword.find(query)
        .select(
          "keyword targetDomain language searchEngine location device createdAt"
        )
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .lean();

      const total = await Keyword.countDocuments(query);

      res.status(200).json({
        success: true,
        data: {
          keywords: keywords.map((k) => ({
            id: k._id,
            keyword: k.keyword,
            targetDomain: k.targetDomain,
            language: k.language,
            searchEngine: k.searchEngine,
            location: k.location,
            device: k.device,
            createdAt: k.createdAt,
          })),
          pagination: {
            current: parseInt(page),
            pages: Math.ceil(total / limit),
            total,
            hasNext: page < Math.ceil(total / limit),
            hasPrev: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Error fetching keywords:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async getKeywordSuggestions(req, res) {
    try {
      const userId = req.user.id;
      const { targetDomain, limit = 100 } = req.query;

      if (!targetDomain) {
        return res.status(400).json({
          success: false,
          message: "Target domain is required",
        });
      }

      const existingKeywords = await Keyword.find({
        userId,
        targetDomain: targetDomain.toLowerCase(),
        isActive: true,
      })
        .select("keyword")
        .lean();

      const existingKeywordList = existingKeywords.map((k) =>
        k.keyword.toLowerCase()
      );

      const suggestions = await this.generateKeywordSuggestions(
        userId,
        targetDomain,
        existingKeywordList,
        parseInt(limit)
      );

      res.status(200).json({
        success: true,
        data: {
          targetDomain,
          suggestions,
          excludedCount: existingKeywordList.length,
          cached:
            suggestions.length > 0
              ? suggestions.some((s) => s.source !== "fresh_api_call")
              : false,
        },
      });
    } catch (error) {
      console.error("Error generating keyword suggestions:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  // ========== COMPETITOR MANAGEMENT ==========

  // Handle SERP callback - Process full results from DataForSEO callback
  async handleSerpCallback(req, res) {
    try {
      console.log("🔄 SERP CALLBACK RECEIVED (POST):", {
        headers: req.headers,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      const callbackPayload = req.body;

      if (
        !callbackPayload ||
        !callbackPayload.tasks ||
        !callbackPayload.tasks[0]
      ) {
        console.log("❌ Invalid callback payload structure:", callbackPayload);
        return res.status(400).json({
          success: false,
          message: "Invalid callback payload structure",
        });
      }

      const taskData = callbackPayload.tasks[0];
      const taskId = taskData.id;
      const tagData = JSON.parse(taskData.tag || "{}");

      console.log("✅ SERP Callback data received:", {
        taskId,
        status_code: taskData.status_code,
        tagData,
      });

      try {
        const result = await this.rankTrackerService.processSerpCallbackResults(
          callbackPayload
        );

        if (result && result.success) {
          console.log(`✅ SERP callback task ${taskId} processed successfully`);

          // await RankTrackerActivity.create({
          //   userId: tagData.userId,
          //   action: "rankings_updated",
          //   details: {
          //     keyword: tagData.keyword,
          //     domain: tagData.targetDomain,
          //     position: result.position,
          //     processedVia: "callback",
          //     serpFeatures: result.serpFeatures || [],
          //   },
          //   metadata: {
          //     source: "callback",
          //     taskId: taskId,
          //     processingTime: tagData.timestamp
          //       ? Date.now() - tagData.timestamp
          //       : null,
          //   },
          // });

          return res.status(200).json({
            success: true,
            message: "SERP callback processed successfully",
            source: "callback",
            taskId,
            keyword: tagData.keyword,
            position: result.position,
            processingTime: tagData.timestamp
              ? Date.now() - tagData.timestamp
              : null,
          });
        } else {
          console.log(`⚠️ SERP callback task ${taskId} processing failed`);
          return res.status(200).json({
            success: false,
            message: "SERP callback processing failed",
            taskId,
          });
        }
      } catch (processingError) {
        console.error(
          `❌ Error processing SERP callback for task ${taskId}:`,
          processingError
        );

        return res.status(200).json({
          success: false,
          message: "SERP callback processing failed",
          error: processingError.message,
          taskId,
        });
      }
    } catch (error) {
      console.error("❌ SERP callback error:", error);

      res.status(200).json({
        success: false,
        message: "SERP callback processing failed",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Handle AI Mode callback - Process full results from DataForSEO callback
  async handleAiModeCallback(req, res) {
    try {
      console.log("🔄 AI MODE CALLBACK RECEIVED (POST):", {
        headers: req.headers,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      const callbackPayload = req.body;

      if (
        !callbackPayload ||
        !callbackPayload.tasks ||
        !callbackPayload.tasks[0]
      ) {
        console.log("❌ Invalid AI Mode callback payload:", callbackPayload);
        return res.status(400).json({
          success: false,
          message: "Invalid AI Mode callback payload structure",
        });
      }

      const taskData = callbackPayload.tasks[0];
      const taskId = taskData.id;
      const tagData = JSON.parse(taskData.tag || "{}");

      console.log("✅ AI Mode callback data received:", {
        taskId,
        status_code: taskData.status_code,
        tagData,
      });

      try {
        const result =
          await this.rankTrackerService.processAiModeCallbackResults(
            callbackPayload
          );

        if (result && result.length > 0) {
          console.log(
            `✅ AI Mode callback task ${taskId} processed successfully`
          );

          // await RankTrackerActivity.create({
          //   userId: tagData.userId,
          //   action: "ai_mode_updated",
          //   details: {
          //     keyword: tagData.keyword,
          //   },
          //   metadata: {
          //     source: "callback",
          //     taskId: taskId,
          //   },
          // });

          return res.status(200).json({
            success: true,
            message: "AI Mode callback processed successfully",
            source: "callback",
            taskId,
            keyword: tagData.keyword,
            resultsCount: result.length,
            processingTime: tagData.timestamp
              ? Date.now() - tagData.timestamp
              : null,
          });
        } else {
          console.log(`⚠️ AI Mode callback task ${taskId} returned no results`);
          return res.status(200).json({
            success: true,
            message: "AI Mode callback processed - no results found",
            taskId,
          });
        }
      } catch (processingError) {
        console.error(
          `❌ Error processing AI Mode callback for task ${taskId}:`,
          processingError
        );

        return res.status(200).json({
          success: false,
          message: "AI Mode callback processing failed",
          error: processingError.message,
          taskId,
        });
      }
    } catch (error) {
      console.error("❌ AI Mode callback error:", error);

      res.status(200).json({
        success: false,
        message: "AI Mode callback processing failed",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Legacy method aliases for backward compatibility
  async handlePingbackWebhook(req, res) {
    return this.handleSerpCallback(req, res);
  }

  async handleAiModePingbackWebhook(req, res) {
    return this.handleAiModeCallback(req, res);
  }

  async addCompetitor(req, res) {
    try {
      const userId = req.user.id;
      const { competitors } = req.body;

      if (!Array.isArray(competitors) || competitors.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Competitors must be a non-empty array",
        });
      }

      for (const competitor of competitors) {
        if (!competitor.domain || typeof competitor.domain !== "string") {
          return res.status(400).json({
            success: false,
            message: "Each competitor must have a valid domain",
          });
        }
      }

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: "User plan not found",
        });
      }

      const requestedDomains = competitors.map((c) =>
        c.domain.toLowerCase().trim()
      );

      const uniqueDomains = [...new Set(requestedDomains)];
      if (uniqueDomains.length !== requestedDomains.length) {
        return res.status(400).json({
          success: false,
          message: "Duplicate domains found in the request",
        });
      }

      const allExistingCompetitors = await Competitor.find({ userId });
      const existingDomainMap = new Map(
        allExistingCompetitors.map((c) => [c.domain, c])
      );

      const competitorsToAdd = [];
      const competitorsToUpdate = [];
      const competitorsToRemove = [];

      for (const competitor of competitors) {
        const domain = competitor.domain.toLowerCase().trim();
        const existingCompetitor = existingDomainMap.get(domain);

        if (existingCompetitor) {
          competitorsToUpdate.push({
            _id: existingCompetitor._id,
            name: competitor.name || competitor.domain,
          });
        } else {
          competitorsToAdd.push({
            userId,
            domain: domain,
            name: competitor.name || competitor.domain,
            stats: {
              positionDistribution: {
                top3: 0,
                top10: 0,
                top20: 0,
                top50: 0,
                top100: 0,
              },
              aiMentions: {
                googleAiOverview: 0,
                googleAiMode: 0,
                chatgpt: 0,
                totalKeywords: 0,
              },
            },
          });
        }
      }

      for (const [domain, competitor] of existingDomainMap.entries()) {
        if (!uniqueDomains.includes(domain)) {
          competitorsToRemove.push(competitor);
        }
      }

      const finalCount =
        allExistingCompetitors.length +
        competitorsToAdd.length -
        competitorsToRemove.length;

      if (
        userPlan.rankTracker.limits.competitors !== -1 &&
        finalCount > userPlan.rankTracker.limits.competitors
      ) {
        return res.status(400).json({
          success: false,
          message: "Adding these competitors would exceed your plan limit",
          data: {
            current: allExistingCompetitors.length,
            requesting: competitorsToAdd.length,
            limit: userPlan.rankTracker.limits.competitors,
            available:
              userPlan.rankTracker.limits.competitors -
              allExistingCompetitors.length +
              competitorsToRemove.length,
          },
        });
      }

      let savedCompetitors = [];
      let updatedCompetitors = [];
      let removedCompetitors = [];

      if (competitorsToRemove.length > 0) {
        for (const comp of competitorsToRemove) {
          await Competitor.findByIdAndDelete(comp._id);
          removedCompetitors.push({
            domain: comp.domain,
            name: comp.name,
          });
        }
      }

      if (competitorsToAdd.length > 0) {
        savedCompetitors = await Competitor.insertMany(competitorsToAdd);
      }

      if (competitorsToUpdate.length > 0) {
        for (const comp of competitorsToUpdate) {
          const updated = await Competitor.findByIdAndUpdate(
            comp._id,
            { name: comp.name },
            { new: true }
          );
          if (updated) {
            updatedCompetitors.push(updated);
          }
        }
      }

      try {
        const userKeywords = await Keyword.find({ userId, isActive: true })
          .select("targetDomain")
          .lean();

        const userDomains = [
          ...new Set(userKeywords.map((k) => k.targetDomain)),
        ];

        for (const userDomain of userDomains) {
          for (const competitor of [
            ...savedCompetitors,
            ...updatedCompetitors,
          ]) {
            try {
              await this.updateCompetitorSuggestionFlag(
                userDomain,
                competitor.domain,
                true
              );
            } catch (flagError) {
              console.error(
                `Error updating competitor suggestion flag for ${userDomain} -> ${competitor.domain}:`,
                flagError
              );
            }
          }

          for (const competitor of removedCompetitors) {
            try {
              await this.updateCompetitorSuggestionFlag(
                userDomain,
                competitor.domain,
                false
              );
            } catch (flagError) {
              console.error(
                `Error updating competitor suggestion flag for ${userDomain} -> ${competitor.domain}:`,
                flagError
              );
            }
          }
        }
      } catch (flagError) {
        console.error("Error updating competitor suggestion flags:", flagError);
      }

      const allCompetitors = [...savedCompetitors, ...updatedCompetitors];

      res.status(201).json({
        success: true,
        message: `${savedCompetitors.length} competitor(s) added, ${updatedCompetitors.length} competitor(s) updated, ${removedCompetitors.length} competitor(s) removed`,
        data: {
          competitors: allCompetitors.map((competitor) => ({
            id: competitor._id,
            domain: competitor.domain,
            name: competitor.name,
            createdAt: competitor.createdAt,
          })),
          totalAdded: savedCompetitors.length,
          totalUpdated: updatedCompetitors.length,
          totalRemoved: removedCompetitors.length,
          newTotal: finalCount,
        },
      });
    } catch (error) {
      console.error("Error syncing competitors:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async removeCompetitor(req, res) {
    try {
      const userId = req.user.id;
      const { competitorId } = req.params;

      if (!competitorId) {
        return res.status(400).json({
          success: false,
          message: "Competitor ID is required",
        });
      }

      const competitor = await Competitor.findOne({
        _id: competitorId,
        userId,
      });

      if (!competitor) {
        return res.status(404).json({
          success: false,
          message: "Competitor not found or already deleted",
        });
      }

      const competitorDetails = {
        domain: competitor.domain,
        name: competitor.name,
      };

      await Competitor.findByIdAndDelete(competitorId);

      try {
        const userKeywords = await Keyword.find({ userId, isActive: true })
          .select("targetDomain")
          .lean();

        const userDomains = [
          ...new Set(userKeywords.map((k) => k.targetDomain)),
        ];

        for (const userDomain of userDomains) {
          try {
            await this.updateCompetitorSuggestionFlag(
              userDomain,
              competitorDetails.domain,
              false
            );
          } catch (flagError) {
            console.error(
              `Error updating competitor suggestion flag for ${userDomain} -> ${competitorDetails.domain}:`,
              flagError
            );
          }
        }
      } catch (flagError) {
        console.error("Error updating competitor suggestion flags:", flagError);
      }

      res.status(200).json({
        success: true,
        message: "Competitor removed successfully",
        data: {
          removed: {
            domain: competitorDetails.domain,
            name: competitorDetails.name,
          },
        },
      });
    } catch (error) {
      console.error("Error removing competitor:", error);

      if (error.name === "CastError") {
        return res.status(400).json({
          success: false,
          message: "Invalid competitor ID format",
        });
      }

      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async getAllCompetitors(req, res) {
    try {
      const userId = req.user.id;

      const competitors = await Competitor.find({ userId, isActive: true })
        .select("domain name createdAt")
        .sort({ name: 1 })
        .lean();

      res.status(200).json({
        success: true,
        data: {
          competitors: competitors.map((c) => ({
            id: c._id,
            domain: c.domain,
            name: c.name,
            createdAt: c.createdAt,
          })),
        },
      });
    } catch (error) {
      console.error("Error fetching competitors:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async getCompetitorSuggestions(req, res) {
    try {
      const userId = req.user.id;
      const { targetDomain, limit = 10 } = req.query;

      if (!targetDomain) {
        return res.status(400).json({
          success: false,
          message: "Target domain is required",
        });
      }

      const existingCompetitors = await Competitor.find({
        userId,
        isActive: true,
      })
        .select("domain")
        .lean();

      const existingDomains = existingCompetitors.map((c) => c.domain);

      const cachedSuggestions = await CompetitorSuggestion.find({
        domain: targetDomain,
      }).sort({ _id: -1 });

      let suggestions = [];

      if (cachedSuggestions.length > 0) {
        suggestions = cachedSuggestions
          .filter(
            (item) =>
              item.competitorDomain !== targetDomain &&
              !existingDomains.includes(item.competitorDomain)
          )
          .slice(0, parseInt(limit))
          .map((suggestion) => ({
            competitorDomain: suggestion.competitorDomain,
            name: this.formatDomainName(suggestion.competitorDomain),
            source: suggestion.source || "dataforseo_serp",
            isAdded: existingDomains.includes(suggestion.competitorDomain),
          }));
      } else {
        console.log("No cached suggestions found, fetching mock competitors");
        const mockCompetitors = [
          "tripadvisor.co.uk",
          "booking.com",
          "expedia.com",
          "hotels.com",
          "airbnb.com",
          "kayak.com",
          "priceline.com",
          "agoda.com",
          "trivago.com",
          "orbitz.com",
        ]
          .filter(
            (domain) =>
              domain !== targetDomain && !existingDomains.includes(domain)
          )
          .slice(0, parseInt(limit));

        suggestions = mockCompetitors.map((domain) => ({
          competitorDomain: domain,
          name: this.formatDomainName(domain),
          source: "dataforseo_serp",
          isAdded: false,
        }));
      }

      res.status(200).json({
        success: true,
        data: {
          targetDomain: targetDomain,
          suggestions,
          excludedCount: existingDomains.length,
          cached: cachedSuggestions.length > 0,
        },
      });
    } catch (error) {
      console.error("Error getting competitor suggestions:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  normalizeDomain(domain) {
    if (!domain) return "";
    return domain
      .replace(/^https?:\/\//, "") // remove http:// or https://
      .replace(/^www\./, "") // remove www.
      .replace(/\/$/, "") // remove trailing slash
      .trim()
      .toLowerCase();
  }

  async getDashboardRankings(req, res) {
    try {
      const userId = req.user.id;
      const { targetDomain } = req.query;

      const keywordDocs = await Keyword.find({
        userId,
        targetDomain: targetDomain,
        isActive: true,
      }).sort({createdAt: -1}).lean();

      if (!keywordDocs || keywordDocs.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No keywords found for this domain",
        });
      }

      const userPlan = await UserPlan.findOne({ userId });
      const hasAiAccess = userPlan?.canAccessAiTracking() || false;

      const competitors = await Competitor.find({ userId, isActive: true });

      const keywordsData = [];

      for (const keywordDoc of keywordDocs) {
        const normalizedTarget = this.normalizeDomain(keywordDoc.targetDomain);

        const targetRanking = await MonthlyRanking.findOne({
          userId,
          keywordId: keywordDoc._id,
        }).then((rank) =>
          rank && this.normalizeDomain(rank.domain) === normalizedTarget
            ? rank
            : null
        );

        const competitorDomains = competitors.map((c) =>
          this.normalizeDomain(c.domain)
        );

        const competitorRankingsRaw = await MonthlyRanking.find({
          userId,
          keywordId: keywordDoc._id,
        });

        // Filter rankings whose normalized domain matches one of the competitor domains
        const competitorRankings = competitorRankingsRaw.filter((r) =>
          competitorDomains.includes(this.normalizeDomain(r.domain))
        );

        let targetAiTracking = null;
        if (hasAiAccess) {
          const targetMonth = keywordDoc?.lastChecked
            ? this.getMonthStringFromDate(keywordDoc?.lastChecked)
            : null;

          targetAiTracking = await this.getLatestAiTrackingData(
            keywordDoc.keyword,
            keywordDoc.targetDomain,
            targetMonth
          );
        }

        const targetData = {
          domain: keywordDoc.targetDomain,
          currentPosition: targetRanking?.currentPosition || null,
          previousPosition: this.getPreviousPosition(targetRanking),
          trend: this.calculateTrend(
            targetRanking?.currentPosition,
            this.getPreviousPosition(targetRanking)
          ),
          url: targetRanking?.rankings?.[0]?.url || null,
          title: targetRanking?.rankings?.[0]?.title || null,
          aiTracking: hasAiAccess ? targetAiTracking : null,
        };

        const competitorData = [];
        for (const competitor of competitors) {
          const ranking = competitorRankings.find(
            (r) =>
              this.normalizeDomain(r.domain) ===
              this.normalizeDomain(competitor.domain)
          );

          let competitorAiTracking = null;
          if (hasAiAccess) {
            const competitorMonth = keywordDoc?.lastChecked
              ? this.getMonthStringFromDate(keywordDoc?.lastChecked)
              : null;

            competitorAiTracking = await this.getLatestAiTrackingData(
              keywordDoc.keyword,
              this.normalizeDomain(competitor.domain),
              competitorMonth
            );
          }

          competitorData.push({
            domain: competitor.domain,
            name: competitor.name || competitor.domain,
            currentPosition: ranking?.currentPosition || null,
            previousPosition: ranking
              ? this.getPreviousPosition(ranking)
              : null,
            trend: ranking
              ? this.calculateTrend(
                  ranking.currentPosition,
                  this.getPreviousPosition(ranking)
                )
              : null,
            url: ranking?.rankings?.[0]?.url || null,
            title: ranking?.rankings?.[0]?.title || null,
            aiTracking: hasAiAccess ? competitorAiTracking : null,
            hasRankingData: !!ranking,
          });
        }

        keywordsData.push({
          keywordId: keywordDoc._id,
          keyword: keywordDoc.keyword,
          isDataFetched: keywordDoc.isDataFetched || false,
          location: keywordDoc.location,
          device: keywordDoc.device,
          tags: keywordDoc.tags || [],
          target: targetData,
          competitors: competitorData,
          lastUpdated: targetRanking?.lastUpdated || keywordDoc.lastChecked,
          isDataFetched: keywordDoc.isDataFetched,
        });
      }

      const summary = {
        totalKeywords: keywordsData.length,
        rankedKeywords: keywordsData.filter(
          (k) => k.target.currentPosition !== null
        ).length,
        averagePosition: this.calculateAveragePosition(keywordsData),
        improvingKeywords: keywordsData.filter((k) => k.target.trend === "up")
          .length,
        decliningKeywords: keywordsData.filter((k) => k.target.trend === "down")
          .length,
        topRankings: keywordsData.filter(
          (k) => k.target.currentPosition && k.target.currentPosition <= 10
        ).length,
      };

      res.status(200).json({
        success: true,
        data: {
          targetDomain,
          summary,
          keywords: keywordsData,
          hasAiAccess,
          competitorCount: competitors.length,
          lastUpdated: new Date(),
        },
      });
    } catch (error) {
      console.error("Error fetching dashboard rankings:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async getLatestAiTrackingData(keyword, domain, monthString) {
    try {
      if (!monthString) {
        return {
          chatgpt: false,
          aiMode: false,
          aiOverview: false,
        };
      }

      const { MonthlyAiData } = require("../models/rankTracker");

      const aiTracking = {
        chatgpt: false,
        aiMode: false,
        aiOverview: false,
      };

      const carriers = [
        { field: "chatgpt", carrier: "chatgpt" },
        { field: "aiMode", carrier: "ai_mode" },
        { field: "aiOverview", carrier: "ai_overview" },
      ];

      for (const { field, carrier } of carriers) {
        try {
          const aiDataDoc = await MonthlyAiData.findOne({
            keyword: keyword.toLowerCase().trim(),
            month: monthString,
            carrier: carrier,
          })
            .sort({ createdAt: -1 })
            .lean();

          if (
            aiDataDoc &&
            aiDataDoc.results &&
            Array.isArray(aiDataDoc.results)
          ) {
            const domainResult = aiDataDoc.results.find(
              (result) =>
                result.domain &&
                result.domain.toLowerCase() === domain.toLowerCase()
            );

            if (domainResult) {
              aiTracking[field] = true;
            }
          }
        } catch (carrierError) {
          console.error(
            `Error checking AI data for carrier ${carrier}:`,
            carrierError
          );
        }
      }

      return aiTracking;
    } catch (error) {
      console.error(
        `Error getting AI tracking data for ${keyword} - ${domain}:`,
        error
      );
      return {
        chatgpt: false,
        aiMode: false,
        aiOverview: false,
      };
    }
  }

  getMonthStringFromDate(date) {
    try {
      const targetDate = new Date(date);
      if (isNaN(targetDate)) {
        throw new Error("Invalid date");
      }

      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, "0");

      return `${year}-${month}`;
    } catch (error) {
      console.error("Error converting date to month string:", error);
      return null;
    }
  }

  calculateTrend(currentPosition, previousPosition) {
    if (!currentPosition && !previousPosition) return "new";
    if (!previousPosition && currentPosition) return "new";
    if (previousPosition && !currentPosition) return "lost";
    if (currentPosition < previousPosition) return "up";
    if (currentPosition > previousPosition) return "down";
    return "same";
  }

  calculateAveragePosition(keywordsData) {
    const rankedKeywords = keywordsData.filter(
      (k) => k.target.currentPosition !== null
    );
    if (rankedKeywords.length === 0) return null;

    const totalPosition = rankedKeywords.reduce(
      (sum, k) => sum + k.target.currentPosition,
      0
    );
    return Math.round((totalPosition / rankedKeywords.length) * 10) / 10;
  }

  async refreshRankings(req, res) {
    try {
      const userId = req.user.id;
      const { keywordIds } = req.body;

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: "User plan not found",
        });
      }

      if (!userPlan.canUpdateRankings()) {
        return res.status(400).json({
          success: false,
          message: "Manual refresh not allowed based on your plan frequency",
        });
      }

      let query = { userId, isActive: true };
      if (keywordIds && keywordIds.length > 0) {
        query._id = { $in: keywordIds };
      }

      const keywords = await Keyword.find(query);

      if (keywords.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid keywords found",
        });
      }

      let tasksCreated = 0;
      for (const keyword of keywords) {
        try {
          await this.rankTrackerService.createSerpTask({
            keywordId: keyword._id,
            keyword: keyword.keyword,
            location: keyword.location,
            device: keyword.device,
            targetDomain: keyword.targetDomain,
            userId,
          });
          tasksCreated++;
        } catch (error) {
          console.error(
            `Error creating task for keyword ${keyword._id}:`,
            error
          );
        }
      }

      await userPlan.incrementUsage("rankTracker", "updates", 1);

      await RankTrackerActivity.create({
        userId,
        action: "rankings_manual_refresh",
        details: {
          keywordCount: keywords.length,
          taskCount: tasksCreated,
        },
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
          source: "web",
        },
      });

      res.status(200).json({
        success: true,
        message: "Ranking refresh initiated",
        data: {
          keywordsRequested: keywords.length,
          tasksCreated,
          estimatedCompletionTime: "5-10 minutes",
          nextAllowedRefresh: this.calculateNextRefreshTime(userPlan),
        },
      });
    } catch (error) {
      console.error("Error refreshing rankings:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  // ========== HELPER METHODS ==========

  trimDomain(domain) {
    let trimmed = domain.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const parts = trimmed.split(".");
    return parts[0];
  }

  async generateKeywordSuggestions(
    userId,
    targetDomain,
    existingKeywords,
    limit
  ) {
    try {
      const trimmedDomain = this.trimDomain(targetDomain);

      const cachedSuggestions = await KeywordSuggestion.find({
        domain: trimmedDomain,
      })
        .sort({ searchVolume: -1 })
        .lean();

      if (cachedSuggestions && cachedSuggestions.length > 0) {
        console.log(
          `Found ${cachedSuggestions.length} cached keyword suggestions for domain: ${trimmedDomain}`
        );

        const filteredCachedSuggestions = cachedSuggestions.filter(
          (item) => !existingKeywords.includes(item.keyword.toLowerCase())
        );

        console.log(
          `Returning ${filteredCachedSuggestions.length} filtered cached suggestions`
        );
        return filteredCachedSuggestions;
      }

      console.log(
        `No cached suggestions found for domain: ${trimmedDomain}. Calling API...`
      );

      try {
        const seedKeywords = [trimmedDomain];

        const apiKeywords = await this.rankTrackerService.getKeywordSuggestions(
          userId,
          seedKeywords,
          200
        );

        if (apiKeywords && apiKeywords.length > 0) {
          console.log(
            `API returned ${apiKeywords.length} keywords for domain: ${trimmedDomain}`
          );

          const topKeywordsByVolume = apiKeywords
            .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
            .slice(0, 100);

          console.log(
            `Filtered to top ${topKeywordsByVolume.length} keywords by search volume`
          );

          const keywordsToSave = topKeywordsByVolume.map((item) => ({
            domain: trimmedDomain,
            keyword: item.keyword,
            source: item.source || "dataforseo_keywords",
            searchVolume: item.search_volume || 0,
            competition: item.competition || 0,
            isAdded: false,
            createdAt: new Date(),
          }));

          const existingDbKeywords = await KeywordSuggestion.find({
            domain: trimmedDomain,
            keyword: { $in: topKeywordsByVolume.map((k) => k.keyword) },
          })
            .select("keyword")
            .lean();

          const existingKeywordStrings = existingDbKeywords.map(
            (k) => k.keyword
          );
          const newKeywordsToSave = keywordsToSave.filter(
            (k) => !existingKeywordStrings.includes(k.keyword)
          );

          if (newKeywordsToSave.length > 0) {
            await KeywordSuggestion.insertMany(newKeywordsToSave, {
              ordered: false,
            });
            console.log(
              `Saved ${newKeywordsToSave.length} new keyword suggestions for domain: ${trimmedDomain}`
            );
          }

          const updatedCachedSuggestions = await KeywordSuggestion.find({
            domain: trimmedDomain,
          })
            .sort({ searchVolume: -1 })
            .lean();

          const finalFilteredSuggestions = updatedCachedSuggestions.filter(
            (item) => !existingKeywords.includes(item.keyword.toLowerCase())
          );

          console.log(
            `Returning ${finalFilteredSuggestions.length} suggestions sorted by search volume`
          );
          return finalFilteredSuggestions;
        } else {
          console.log("No keywords returned from API");
          return [];
        }
      } catch (apiError) {
        console.error("Error calling keyword suggestions API:", apiError);
        return [];
      }
    } catch (error) {
      console.error("Error generating keyword suggestions:", error);
      return [];
    }
  }

  formatDomainName(domain) {
    return domain
      .replace(/^www\./, "")
      .replace(/\.(com|net|org|io|co\.uk)$/, "")
      .replace(/[-_]/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  getPreviousPosition(rankingDoc) {
    if (
      !rankingDoc ||
      !rankingDoc.monthlyData ||
      rankingDoc.monthlyData.length < 2
    ) {
      return null;
    }

    const sortedRankings = rankingDoc.monthlyData.sort((a, b) =>
      b.month.localeCompare(a.month)
    );
    return sortedRankings[1]?.position || null;
  }

  calculateNextRefreshTime(userPlan) {
    const frequency = userPlan.rankTracker.limits.updateFrequency;
    const lastUpdate = userPlan.rankTracker.usage.lastUpdate;

    if (!lastUpdate) return "now";

    const next = new Date(lastUpdate);
    switch (frequency) {
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
    }

    return next;
  }

  async updateKeywordSuggestionFlag(targetDomain, keyword, isAdded) {
    try {
      const trimmedDomain = this.trimDomain(targetDomain);

      await KeywordSuggestion.updateOne(
        {
          domain: trimmedDomain,
          keyword: keyword.toLowerCase().trim(),
        },
        {
          $set: {
            isAdded: isAdded,
            lastUpdated: new Date(),
          },
        }
      );

      console.log(
        `✅ Updated keyword suggestion flag: ${keyword} -> ${isAdded} for domain: ${trimmedDomain}`
      );
    } catch (error) {
      console.error(
        `❌ Error updating keyword suggestion flag for ${keyword}:`,
        error
      );
    }
  }

  async updateCompetitorSuggestionFlag(
    targetDomain,
    competitorDomain,
    isAdded
  ) {
    try {
      const trimmedTargetDomain = this.trimDomain(targetDomain);
      const trimmedCompetitorDomain = competitorDomain.toLowerCase().trim();

      await CompetitorSuggestion.updateOne(
        {
          domain: trimmedTargetDomain,
          competitorDomain: trimmedCompetitorDomain,
        },
        {
          $set: {
            isAdded: isAdded,
            lastUpdated: new Date(),
          },
        }
      );
    } catch (error) {
      console.error(
        `❌ Error updating competitor suggestion flag for ${competitorDomain}:`,
        error
      );
    }
  }

  async getKeywordRankingAnalysis(req, res) {
    try {
      const userId = req.user.id;
      const { keywordId } = req.body;

      if (!keywordId || !userId) {
        return res.status(400).json({
          success: false,
          message: "keywordId and userId are required",
        });
      }

      if (
        !mongoose.Types.ObjectId.isValid(keywordId) ||
        !mongoose.Types.ObjectId.isValid(userId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid keywordId or userId format",
        });
      }

      const keyword = await Keyword.findOne({
        _id: keywordId,
        userId: userId,
        isActive: true,
      });

      if (!keyword) {
        return res.status(404).json({
          success: false,
          message: "Keyword not found or inactive",
        });
      }

      const userplan = await UserPlan.findOne({ userId: userId });
      if (!userplan) {
        return res.status(404).json({
          success: false,
          message: "User not found or no active domain in plan",
        });
      }

      const activeDomain = userplan.activeDomain;

      const activeRanking = await MonthlyRanking.findOne({
        userId: userId,
        keywordId: keywordId,
        domain: activeDomain,
      });

      const competitors = await Competitor.find({
        userId: userId,
        isActive: true,
      });

      const competitorDomains =
        competitors.length > 0 ? competitors.map((comp) => comp.domain) : [];

      const competitorRankings =
        competitorDomains.length > 0
          ? await MonthlyRanking.find({
              userId: userId,
              keywordId: keywordId,
              domain: { $in: competitorDomains },
            })
          : [];

      const formatDate = (dateString) => {
        const date = new Date(dateString + "-01");
        const options = { day: "numeric", month: "short", year: "numeric" };
        return date.toLocaleDateString("en-GB", options);
      };

      const competitorsData = competitors.map((competitor) => {
        const competitorRanking = competitorRankings.find(
          (ranking) => ranking.domain === competitor.domain
        );

        if (!competitorRanking || competitorRanking.rankings.length === 0) {
          return {
            domain: competitor.domain,
            name: competitor.name || competitor.domain,
            currentPosition: null,
            lastUpdated: null,
            trend: "no_data",
            url: null,
            title: null,
            rankingHistory: {},
          };
        }

        const sortedRankings = competitorRanking.rankings.sort((a, b) =>
          b.month.localeCompare(a.month)
        );
        const latestRanking = sortedRankings[0];

        const competitorHistory = {};
        competitorRanking.rankings.forEach((ranking) => {
          const formattedDate = formatDate(ranking.month);
          const position = ranking.position > 100 ? 101 : ranking.position;
          competitorHistory[formattedDate] = position;
        });

        return {
          domain: competitor.domain,
          name: competitor.name || competitor.domain,
          currentPosition: latestRanking.position || null,
          lastUpdated: latestRanking.checkedAt,
          trend: latestRanking.trend || "same",
          url: latestRanking.url || null,
          title: latestRanking.title || null,
          rankingHistory: competitorHistory,
        };
      });

      const rankingHistory = {};
      let positions = [];
      let sortedActiveRankings = [];

      if (
        activeRanking &&
        activeRanking.rankings &&
        activeRanking.rankings.length > 0
      ) {
        const sortedRankings = activeRanking.rankings.sort((a, b) =>
          a.month.localeCompare(b.month)
        );

        sortedRankings.forEach((ranking) => {
          const formattedDate = formatDate(ranking.month);
          const position = ranking.position > 100 ? 101 : ranking.position;
          rankingHistory[formattedDate] = position;
        });

        positions = activeRanking.rankings
          .map((ranking) => (ranking.position > 100 ? 101 : ranking.position))
          .filter((pos) => pos !== null && pos !== undefined);

        sortedActiveRankings = activeRanking.rankings.sort((a, b) =>
          b.month.localeCompare(a.month)
        );
      } else {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const formattedCurrentMonth = formatDate(currentMonth);
        rankingHistory[formattedCurrentMonth] = 101;
        positions = [101];
      }

      const extremePositions =
        positions.length > 0
          ? {
              best: Math.min(...positions),
              worst: Math.max(...positions),
            }
          : {
              best: 101,
              worst: 101,
            };

      const currentRanking =
        sortedActiveRankings.length > 0 ? sortedActiveRankings[0] : null;
      const previousRanking =
        sortedActiveRankings.length > 1 ? sortedActiveRankings[1] : null;

      const comparison = {
        current: {
          position: currentRanking
            ? currentRanking.position > 100
              ? 101
              : currentRanking.position
            : 101,
          month: currentRanking
            ? formatDate(currentRanking.month)
            : formatDate(new Date().toISOString().slice(0, 7)),
          url: currentRanking ? currentRanking.url : null,
          title: currentRanking ? currentRanking.title : null,
        },
        previous: {
          position: previousRanking
            ? previousRanking.position > 100
              ? 101
              : previousRanking.position
            : null,
          month: previousRanking ? formatDate(previousRanking.month) : null,
          url: previousRanking ? previousRanking.url : null,
          title: previousRanking ? previousRanking.title : null,
        },
        change: null,
        trend: currentRanking ? currentRanking.trend : "no_data",
      };

      if (comparison.current.position && comparison.previous.position) {
        comparison.change =
          comparison.previous.position - comparison.current.position;
      }

      const response = {
        success: true,
        data: {
          keyword: {
            id: keyword._id,
            keyword: keyword.keyword,
            targetDomain: keyword.targetDomain,
            location: keyword.location,
            device: keyword.device,
            language: keyword.language,
            searchEngine: keyword.searchEngine,
          },
          activeDomain: activeDomain,
          competitors: competitorsData,
          myRankingHistory: rankingHistory,
          extremePositions: extremePositions,
          comparison: comparison,
          summary: {
            totalCompetitors: competitors.length,
            competitorsWithData: competitorsData.filter(
              (c) => c.currentPosition !== null
            ).length,
            rankingDataPoints: Object.keys(rankingHistory).length,
            lastUpdated: activeRanking ? activeRanking.lastUpdated : new Date(),
          },
        },
      };

      return res.status(200).json(response);
    } catch (error) {
      console.error("Error in getKeywordRankingAnalysis:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
  async testManualKeywordUpdate(req, res) {
    try {
      console.log("🧪 TEST: Manual keyword update started...");

      const allKeywords = await Keyword.find({
        isActive: true,
      }).populate("userId");

      if (allKeywords.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No active keywords found in database",
          data: { totalKeywords: 0, tasksCreated: 0 },
        });
      }

      console.log(
        `📊 Found ${allKeywords.length} active keywords for test update`
      );

      const userGroups = this.groupKeywordsByUser(allKeywords);
      let totalTasksCreated = 0;
      let failedTasks = 0;
      const results = [];

      for (const [userId, userKeywords] of userGroups) {
        try {
          const userPlan = await UserPlan.findOne({ userId: userId });
          if (!userPlan) {
            console.log(`⚠️ No plan found for user ${userId}, skipping...`);
            continue;
          }

          let userTasksCreated = 0;
          let userFailedTasks = 0;

          for (const keyword of userKeywords) {
            try {
              await this.rankTrackerService.createSerpTask({
                keywordId: keyword._id,
                keyword: keyword.keyword,
                location: keyword.location,
                device: keyword.device,
                targetDomain: keyword.targetDomain,
                userId: keyword.userId._id,
              });

              userTasksCreated++;
              totalTasksCreated++;

              await this.delay(150);
            } catch (error) {
              console.error(
                `❌ Error creating test task for keyword ${keyword._id}:`,
                error
              );
              userFailedTasks++;
              failedTasks++;
            }
          }

          results.push({
            userId: userId,
            keywordCount: userKeywords.length,
            tasksCreated: userTasksCreated,
            failedTasks: userFailedTasks,
          });

          console.log(
            `✅ User ${userId}: ${userTasksCreated}/${userKeywords.length} tasks created`
          );
        } catch (error) {
          console.error(
            `❌ Error processing test keywords for user ${userId}:`,
            error
          );
        }
      }

      console.log(
        `✅ TEST completed: ${totalTasksCreated} tasks created, ${failedTasks} failed`
      );

      res.status(200).json({
        success: true,
        message: "Test keyword update completed",
        data: {
          totalKeywords: allKeywords.length,
          tasksCreated: totalTasksCreated,
          failedTasks: failedTasks,
          userCount: userGroups.size,
          estimatedCompletionTime: "5-15 minutes",
          userResults: results,
        },
      });
    } catch (error) {
      console.error("❌ Error in test keyword update:", error);
      res.status(500).json({
        success: false,
        message: "Test update failed",
        error: error.message,
      });
    }
  }

  groupKeywordsByUser(keywords) {
    const userGroups = new Map();

    keywords.forEach((keyword) => {
      const userId = keyword.userId._id
        ? keyword.userId._id.toString()
        : keyword.userId.toString();

      if (!userGroups.has(userId)) {
        userGroups.set(userId, []);
      }

      userGroups.get(userId).push(keyword);
    });

    return userGroups;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = CustomRankTrackerController;
