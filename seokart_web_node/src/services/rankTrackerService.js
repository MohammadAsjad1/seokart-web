const axios = require("axios");
const {
  Keyword,
  Competitor,
  Task,
  MonthlyRanking,
  SerpSnapshot,
  RankTrackerActivity,
  KeywordSuggestion,
  CompetitorSuggestion,
  MonthlyAiData,
  AiModeTask,
} = require("../models/rankTracker");
const { UserPlan } = require("../models/userPlan");
const DataForSeoUsageTracker = require("../config/usageTracker");
const dotenv = require("dotenv");
dotenv.config();

class RankTrackerService {
  constructor() {
    this.serpApiConfig = {
      baseURL: process.env.SERP_API_URL,
      username: process.env.SERP_API_USERNAME,
      password: process.env.SERP_API_PASSWORD,
      timeout: 30000,
    };

    this.chatGptConfig = {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://api.openai.com/v1/chat/completions",
    };

    DataForSeoUsageTracker.initializePricingCache();
  }

  async createSerpTask(keywordData) {
    try {
      const { keywordId, keyword, location, device, targetDomain, userId } = keywordData;


      const userPlan = await UserPlan.findOne({ userId });
      const includeAiTracking = userPlan?.canAccessAiTracking() || false;

      // Use callback_url instead of pingback_url for POST data
      const callbackUrl = `${process.env.BASE_URL}/api/rank-tracker/callback`;
      const tagData = JSON.stringify({
        keywordId,
        userId,
        targetDomain,
        keyword,
        timestamp: Date.now(),
      });


      const taskPayload = [
        {
          keyword: encodeURI(keyword.trim()),
          calculate_rectangles: true,
          depth: 50, 
          language_code: this.getLanguageCode(location || "United States"),
          location_code: this.getLocationCode(location || "United States"),
          async_aioverview: includeAiTracking,
          postback_url: callbackUrl,
          postback_data: 'regular',
          tag: tagData,
          priority: 1,
        },
      ];

      const trackingTaskId = `serp_post_${Date.now()}_${userId}`;

      const usageRecord = await DataForSeoUsageTracker.trackApiCall({
        taskId: trackingTaskId,
        userId,
        keywordId,
        endpoint: "serp_google_organic_task_post",
        requestData: {
          keyword,
          location,
          device,
          targetDomain,
          includeAiTracking,
        },
        apiType: "SERP",
      });

      const response = await axios({
        method: "post",
        url: this.serpApiConfig.baseURL + "/v3/serp/google/organic/task_post",
        auth: {
          username: this.serpApiConfig.username,
          password: this.serpApiConfig.password,
        },
        data: taskPayload,
        headers: {
          "content-type": "application/json",
        },
        timeout: this.serpApiConfig.timeout,
      });

      if (response.data && response.data.tasks && response.data.tasks[0]) {
        const task = response.data.tasks[0];

        if (task.status_code === 20100) {
          const taskId = task.id;

          if (usageRecord) {
            await DataForSeoUsageTracker.updateApiCallResult(
              trackingTaskId,
              {
                taskId: taskId,
                statusCode: task.status_code,
                cost: task.cost || 0,
              },
              "success"
            );
          }

          // Save task to database with callback info
          const dbTask = new Task({
            userId,
            taskId,
            keywordId,
            status: "pending",
            requestData: {
              keyword,
              location,
              device,
              targetDomain,
              includeAiTracking,
            },
            callbackInfo: {
              url: callbackUrl,
              tag: tagData,
              registered: true,
            },
          });

          await dbTask.save();

          // Create AI Mode task if AI tracking is enabled
          let aiModeTaskId = null;
          if (includeAiTracking) {
            try {
              aiModeTaskId = await this.createAiModeTask(
                userId,
                keywordId,
                keyword,
                location
              );
              console.log("AI Mode task created:", aiModeTaskId);
            } catch (aiModeError) {
              console.error("Failed to create AI Mode task:", aiModeError.message);
            }
          }

          await Keyword.findByIdAndUpdate(keywordId, {
            lastTaskId: taskId,
            nextScheduledCheck: this.calculateNextCheck(
              userPlan?.rankTracker?.limits?.updateFrequency || "monthly"
            ),
          });

          console.log("SERP task created with callback:", taskId);

          return {
            success: true,
            taskId,
            aiModeTaskId,
            message: "SERP task created successfully",
            cost: task.cost || 0,
            callbackUrl,
          };
        } else {
          if (usageRecord) {
            await DataForSeoUsageTracker.updateApiCallResult(
              trackingTaskId,
              {
                statusCode: task.status_code,
                statusMessage: task.status_message,
              },
              "failed",
              { message: task.status_message, code: task.status_code }
            );
          }

          console.error("SERP API task error:", task);
          throw new Error(`SERP API error: ${task.status_message}`);
        }
      } else {
        if (usageRecord) {
          await DataForSeoUsageTracker.updateApiCallResult(
            trackingTaskId,
            null,
            "failed",
            {
              message: "Invalid response from SERP API",
              code: "INVALID_RESPONSE",
            }
          );
        }

        console.error("Invalid SERP API response:", response.data);
        throw new Error("Invalid response from SERP API");
      }
    } catch (error) {
      console.error("Error creating SERP task:", error);

      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response data:", JSON.stringify(error.response.data, null, 2));
      }

      throw error;
    }
  }

  async createAiModeTask(userId, keywordId, keyword, location) {
    try {
      // Construct callback URL for AI Mode tasks
      const aiModeCallbackUrl = `${process.env.BASE_URL}/api/rank-tracker/ai-mode-callback`;

      const tagData = JSON.stringify({
        keywordId,
        userId,
        keyword: keyword.trim(),
        location: location || "United States",
        timestamp: Date.now(),
        taskType: "ai_mode",
      });

      console.log("AI Mode Callback URL configured:", aiModeCallbackUrl);

      const post_array = [];
      post_array.push({
        language_code: "en",
        location_code: this.getLocationCode(location || "United States"),
        keyword: encodeURI(keyword.trim()),
        postback_url: aiModeCallbackUrl,
        postback_data: 'advanced',
        tag: tagData,
      });

      const trackingTaskId = `ai_mode_post_${Date.now()}_${userId}`;

      const usageRecord = await DataForSeoUsageTracker.trackApiCall({
        taskId: trackingTaskId,
        userId,
        keywordId,
        endpoint: "serp_google_ai_mode_task_post",
        requestData: {
          keyword,
          location: location || "United States",
          language_code: "en",
          location_code: this.getLocationCode(location || "United States"),
        },
        apiType: "SERP",
      });

      const postResponse = await axios({
        method: "post",
        url: this.serpApiConfig.baseURL + "/v3/serp/google/ai_mode/task_post",
        auth: {
          username: this.serpApiConfig.username,
          password: this.serpApiConfig.password,
        },
        data: post_array,
        headers: {
          "content-type": "application/json",
        },
        timeout: 30000,
      });

      if (!postResponse.data?.tasks?.[0]) {
        throw new Error("Failed to create AI Mode task - No task data in response");
      }

      const task = postResponse.data.tasks[0];

      if (task.status_code !== 20100) {
        if (usageRecord) {
          await DataForSeoUsageTracker.updateApiCallResult(
            trackingTaskId,
            {
              statusCode: task.status_code,
              statusMessage: task.status_message,
            },
            "failed",
            {
              message: task.status_message || "Unknown error",
              code: task.status_code,
            }
          );
        }
        throw new Error(`AI Mode task creation failed: ${task.status_message || "Unknown error"}`);
      }

      const taskId = task.id;

      if (!taskId) {
        throw new Error("AI Mode task created but no task ID returned");
      }

      if (usageRecord) {
        await DataForSeoUsageTracker.updateApiCallResult(
          trackingTaskId,
          {
            taskId: taskId,
            statusCode: task.status_code,
            cost: task.cost || 0,
          },
          "success"
        );
      }

      const aiModeTask = new AiModeTask({
        userId,
        taskId,
        keywordId,
        status: "pending",
        requestData: {
          keyword: keyword.trim(),
          location: location || "United States",
          language: this.getLanguageCode(location || "United States"),
        },
        callbackInfo: {
          url: aiModeCallbackUrl,
          tag: tagData,
          registered: true,
        },
        callbackReceived: false,
        callbackReceivedAt: null,
        dataFetchedBy: "callback",
        dataFetchedAt: null,
      });

      await aiModeTask.save();

      console.log(`AI Mode task created successfully with callback: ${taskId}`);
      return taskId;
    } catch (error) {
      console.error("Error creating AI Mode task:", error);
      throw error;
    }
  }

  getLocationCode(locationName) {
    const locationCodes = {
      "United States": 2840,
      "United Kingdom": 2826,
      Canada: 2124,
      Australia: 2036,
      Germany: 2276,
      France: 2250,
      India: 2356,
      Brazil: 2076,
      Japan: 2392,
      "South Korea": 2410,
    };

    return locationCodes[locationName] || 2840;
  }

  getLanguageCode(location) {
    const languageCodes = {
      "United States": "en",
      "United Kingdom": "en",
      Canada: "en",
      Australia: "en",
      Germany: "de",
      France: "fr",
      India: "en",
      Brazil: "pt",
      Japan: "ja",
      "South Korea": "ko",
    };

    return languageCodes[location] || "en";
  }

  // Process SERP results directly from callback payload
  async processSerpCallbackResults(callbackPayload) {
    console.log(callbackPayload, "Processing SERP Callback Payload");
    try {
      const taskData = callbackPayload.tasks[0];
      const results = taskData.result[0];
      const taskId = taskData.id;

      // Find the task in database
      const task = await Task.findOne({ taskId, status: "pending" });
      if (!task) {
        console.log(`Task ${taskId} not found or already processed`);
        return null;
      }

      const keyword = await Keyword.findById(task.keywordId);
      const userPlan = await UserPlan.findOne({ userId: task.userId });
      const includeAiTracking = userPlan?.canAccessAiTracking() || false;

      // Process organic results
      const organicResults = results.items || [];
      const targetDomainResult = this.findTargetDomainResult(
        organicResults,
        task.requestData.targetDomain
      );

      let aiOverviewData = {
        googleAiOverview: false,
        googleAiMode: false,
        chatgptIncluded: false,
      };

      if (includeAiTracking) {
        aiOverviewData = await this.checkAiMentions(
          task.requestData.keyword,
          task.requestData.targetDomain,
          results,
          task.userId,
          task.keywordId
        );
      }

      const itemTypes = results.item_types || [];

      await this.updateKeywordRanking(
        keyword,
        targetDomainResult,
        itemTypes,
        aiOverviewData
      );

      // Process monthly rankings
      try {
        await this.updateMonthlyRanking(
          task.userId,
          task.keywordId,
          task.requestData.keyword,
          organicResults,
          itemTypes,
          aiOverviewData
        );
      } catch (error) {
        console.error(`Error processing monthly rankings:`, error);
      }

      // Process competitor suggestions
      try {
        await this.processCompetitorSuggestions(
          task.requestData.targetDomain,
          organicResults,
          task.requestData.keyword
        );
        console.log("Competitor suggestions processed successfully");
      } catch (error) {
        console.error(`Error processing competitor suggestions:`, error);
      }

      // Mark task as completed
      await Task.findByIdAndUpdate(task._id, {
        status: "completed",
        completedAt: new Date(),
        responseData: {
          totalResults: results.total_count,
          itemTypes: itemTypes,
          organicResults: organicResults.slice(0, 10).map((item) => ({
            position: item.rank_group,
            domain: this.extractDomain(item.url),
            url: item.url,
            title: item.title,
            snippet: item.snippet,
          })),
        },
      });

      await Keyword.findByIdAndUpdate(task.keywordId, {
        isDataFetched: true,
        lastChecked: new Date(),
        tags: itemTypes,
      });

      await RankTrackerActivity.create({
        userId: task.userId,
        action: "rankings_updated",
        details: {
          keyword: task.requestData.keyword,
          domain: task.requestData.targetDomain,
          position: targetDomainResult?.position,
          serpFeatures: itemTypes,
          aiTracking: includeAiTracking,
        },
        metadata: { source: "callback" },
      });

      return {
        success: true,
        keyword: task.requestData.keyword,
        targetDomain: task.requestData.targetDomain,
        position: targetDomainResult?.position,
        serpFeatures: itemTypes,
        aiTracking: aiOverviewData,
      };
    } catch (error) {
      console.error(`Error processing SERP callback results:`, error);
      throw error;
    }
  }

  // Process AI Mode results directly from callback payload
  async processAiModeCallbackResults(callbackPayload) {
    console.log(callbackPayload, "Processing AI Mode Callback Payload");
    const currentMonth = MonthlyRanking.getCurrentMonth();
    let aiModeTask = null;

    try {
      const taskData = callbackPayload.tasks[0];
      const taskId = taskData.id;
      const results = taskData.result[0];

      aiModeTask = await AiModeTask.findOne({
        taskId,
        status: "pending",
      }).sort({ createdAt: -1 });

      if (!aiModeTask) {
        console.log(`No pending AI Mode task found for task ID: ${taskId}`);
        return [];
      }

      const processingStartTime = Date.now();

      await AiModeTask.findOneAndUpdate(
        { taskId: aiModeTask.taskId },
        { status: "processing" }
      );

      const domainsSet = new Set();
      const extractedResults = [];

      if (taskData.status_code === 20000 && results) {
        const aiModeData = this.extractDataForSEOAiMode({ tasks: [taskData] });

        aiModeData.forEach((item, index) => {
          if (!domainsSet.has(item.domain)) {
            domainsSet.add(item.domain);
            extractedResults.push({
              domain: item.domain,
              url: item.url,
              title: item.title,
              snippet: item.snippet,
              position: index + 1,
              relevanceScore: this.calculateRelevanceScore(
                item.title,
                item.snippet,
                aiModeTask.requestData.keyword
              ),
              mentionContext: item.mentionContext,
            });
          }
        });

        await this.storeMonthlyAiData({
          userId: aiModeTask.userId,
          keywordId: aiModeTask.keywordId,
          keyword: aiModeTask.requestData.keyword,
          month: currentMonth,
          carrier: "ai_mode",
          results: extractedResults,
          totalResults: extractedResults.length,
          processingTime: Date.now() - processingStartTime,
          dataQuality: {
            completeness: this.calculateCompleteness(extractedResults),
            freshness: new Date(),
          },
          rawResponse: {
            content: this.extractAiModeContent({ tasks: [taskData] })?.substring(0, 2000) || "",
            sources: extractedResults.map((r) => r.url).filter(Boolean),
            confidence: null,
          },
        });

        await AiModeTask.findOneAndUpdate(
          { taskId: aiModeTask.taskId },
          { 
            status: "completed", 
            completedAt: new Date(),
            dataFetchedAt: new Date()
          }
        );

        console.log(`AI Mode task ${aiModeTask.taskId} completed successfully via callback`);
        return Array.from(domainsSet);
      } else {
        await this.storeMonthlyAiData({
          userId: aiModeTask.userId,
          keywordId: aiModeTask.keywordId,
          keyword: aiModeTask.requestData.keyword,
          month: currentMonth,
          carrier: "ai_mode",
          results: [],
          totalResults: 0,
          processingTime: Date.now() - processingStartTime,
          dataQuality: { completeness: 0, freshness: new Date() },
          rawResponse: {
            content: `Callback Status: ${taskData.status_code}`,
            sources: [],
            confidence: null,
          },
        });

        await AiModeTask.findOneAndUpdate(
          { taskId: aiModeTask.taskId },
          {
            status: "failed",
            errorMessage: "No results in callback payload",
            completedAt: new Date(),
          }
        );

        console.error(`AI Mode task ${aiModeTask.taskId} failed: No results in callback`);
        return [];
      }

      return [];
    } catch (error) {
      console.error("Error processing AI Mode callback data:", error);

      if (aiModeTask) {
        try {
          await AiModeTask.findOneAndUpdate(
            { taskId: aiModeTask.taskId },
            {
              status: "failed",
              errorMessage: error.message,
              completedAt: new Date(),
            }
          );
        } catch (updateError) {
          console.error("Error updating task status:", updateError);
        }
      }

      const currentMonth = MonthlyRanking.getCurrentMonth();
      await this.storeMonthlyAiData({
        userId: aiModeTask?.userId,
        keywordId: aiModeTask?.keywordId,
        keyword: aiModeTask?.requestData?.keyword || "unknown",
        month: currentMonth,
        carrier: "ai_mode",
        results: [],
        totalResults: 0,
        processingTime: 0,
        dataQuality: { completeness: 0, freshness: new Date() },
        rawResponse: {
          content: `Error: ${error.message}`,
          sources: [],
          confidence: null,
        },
      });

      return [];
    }
  }

  async processCompetitorSuggestions(targetDomain, organicResults, keyword) {
    try {
      const excludedDomains = [
        "wikipedia.org", "youtube.com", "linkedin.com", "facebook.com",
        "twitter.com", "instagram.com", "pinterest.com", "reddit.com",
        "quora.com", "medium.com", "github.com", "stackoverflow.com",
        "amazon.com", "ebay.com", "google.com", "microsoft.com",
        "apple.com", "adobe.com", "salesforce.com", "hubspot.com",
        "shopify.com", "wordpress.com", "wix.com", "squarespace.com",
        "tiktok.com", "snapchat.com", "telegram.org", "whatsapp.com",
        "zoom.us", "slack.com", "dropbox.com", "netflix.com",
        "spotify.com", "paypal.com", "stripe.com", "apps.shopify.com",
        "bigcommerce.com", "wordpress.org", "developers.google.com",
        "en.wikipedia.org",
      ];

      const targetDomainClean = this.cleanDomain(targetDomain);
      const competitorSuggestions = [];
      const topResults = organicResults.slice(0, 50);
      console.log(`[RANK-TRACKER-SERVICE] Processing competitor suggestions for ${targetDomain} with ${topResults.length} results`);
      for (const result of topResults) {
        if (!result.url) continue;

        const competitorDomainClean = this.cleanDomain(result.url);

        if (
          competitorDomainClean === targetDomainClean ||
          excludedDomains.includes(competitorDomainClean)
        ) {
          continue;
        }

        const existingSuggestion = await CompetitorSuggestion.findOne({
          domain: targetDomainClean,
          competitorDomain: competitorDomainClean,
        });

        if (!existingSuggestion) {
          competitorSuggestions.push({
            domain: targetDomainClean,
            competitorDomain: competitorDomainClean,
            name: this.generateCompetitorName(competitorDomainClean),
            source: "dataforseo_serp",
            isAdded: false,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          });
        }
      }

      if (competitorSuggestions.length > 0) {
        await CompetitorSuggestion.insertMany(competitorSuggestions, {
          ordered: false,
        });
      }
      console.log(`[RANK-TRACKER-SERVICE] Created ${competitorSuggestions.length} competitor suggestions`);
    } catch (error) {
      // Don't throw to avoid breaking main flow
      console.error(`[RANK-TRACKER-SERVICE] Error creating competitor suggestions:`, error.message);
    }
  }

  cleanDomain(domain) {
    if (!domain) return "";
    if (!/^https?:\/\//i.test(domain)) {
      domain = "https://" + domain;
    }
    return new URL(domain).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  }

  generateCompetitorName(domain) {
    if (!domain) return "Unknown";

    const name = domain
      .replace(/\.(com|org|net|edu|gov|co\.uk|co\.in|io|ai|tech|app)$/, "")
      .replace(/[-_]/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

    return name || domain;
  }

  async checkAiMentions(keyword, domain, serpResults, userId, keywordId) {
    const currentMonth = MonthlyRanking.getCurrentMonth();
    const aiData = {
      googleAiOverview: false,
      googleAiMode: false,
      chatgptIncluded: false,
    };

    try {
      if (serpResults.items) {
        const aiOverviewResults = await this.processAiOverviewData(
          serpResults,
          keyword,
          userId,
          keywordId,
          currentMonth
        );
        aiData.googleAiOverview = aiOverviewResults.some(
          (result) => result === this.extractDomain(domain)
        );
      } else {
        await this.storeMonthlyAiData({
          userId,
          keywordId,
          keyword,
          month: currentMonth,
          carrier: "ai_overview",
          results: [],
          rawResponse: { content: "", sources: [], confidence: null },
          totalResults: 0,
        });
      }

      if (this.chatGptConfig.apiKey) {
        const chatGptResults = await this.processChatGptData(
          keyword,
          userId,
          keywordId,
          currentMonth
        );
        aiData.chatgptIncluded = chatGptResults.some(
          (result) => result.domain === this.extractDomain(domain)
        );
      } else {
        await this.storeMonthlyAiData({
          userId,
          keywordId,
          keyword,
          month: currentMonth,
          carrier: "chatgpt",
          results: [],
          rawResponse: {
            content: "API key not configured",
            sources: [],
            confidence: null,
          },
          totalResults: 0,
        });
      }
    } catch (error) {
      console.error("Error checking AI mentions:", error);
    }

    return aiData;
  }

  async processAiOverviewData(aiOverviewData, keyword, userId, keywordId, month) {
    try {
      const results = [];
      let processingStartTime = Date.now();

      const aiOverviewResults = this.extractDataForSEOAiOverview(aiOverviewData);

      if (aiOverviewResults.length > 0) {
        aiOverviewResults.forEach((item, index) => {
          results.push({
            domain: item.domain,
            url: item.url,
            title: item.title,
            snippet: item.snippet,
            position: index + 1,
            relevanceScore: this.calculateRelevanceScore(
              item.title,
              item.snippet,
              keyword
            ),
            mentionContext: item.mentionContext,
          });
        });
      }

      const processingTime = Date.now() - processingStartTime;

      await this.storeMonthlyAiData({
        userId,
        keywordId,
        keyword,
        month,
        carrier: "ai_overview",
        results,
        totalResults: results.length,
        processingTime,
        dataQuality: {
          completeness: this.calculateCompleteness(results),
          freshness: new Date(),
        },
        rawResponse: {
          content: this.extractAiOverviewContent(aiOverviewData)?.substring(0, 2000) || "",
          sources: results.map((r) => r.url).filter(Boolean),
          confidence: this.extractConfidenceScore(aiOverviewData),
        },
      });

      return results;
    } catch (error) {
      console.error("Error processing AI Overview data:", error);
      return [];
    }
  }

  extractDataForSEOAiOverview(dataForSeoResponse) {
    const results = [];

    try {
      const tasks = dataForSeoResponse.items;
      const ai_data = tasks.find((res) => res.type == "ai_overview");
      console.log(ai_data, "ai_data");

      tasks.forEach((item) => {
        if (item.type === "ai_overview") {
          item.references.forEach((ref, index) => {
            if (ref.domain) {
              results.push({
                domain: ref.domain,
                url: ref.url || "",
                title: ref.title || "",
                snippet: ref.text || "",
                mentionContext: `AI Overview Reference ${index + 1}`,
              });
            }
          });

          if (item.items && Array.isArray(item.items)) {
            item.items.forEach((aiItem, itemIndex) => {
              if (aiItem.references && Array.isArray(aiItem.references)) {
                aiItem.references.forEach((ref, refIndex) => {
                  if (ref.domain) {
                    results.push({
                      domain: ref.domain,
                      url: ref.url || "",
                      title: ref.title || "",
                      snippet: ref.text || "",
                      mentionContext: `AI Overview Item ${itemIndex + 1}, Reference ${refIndex + 1}`,
                    });
                  }
                });
              }

              if (aiItem.links && Array.isArray(aiItem.links)) {
                aiItem.links.forEach((link, linkIndex) => {
                  if (link.domain) {
                    results.push({
                      domain: link.domain,
                      url: link.url || "",
                      title: link.title || "",
                      snippet: link.description || "",
                      mentionContext: `AI Overview Item ${itemIndex + 1}, Link ${linkIndex + 1}`,
                    });
                  }
                });
              }
            });
          }
        }

        if (item.type === "knowledge_graph" && item.items) {
          item.items.forEach((kgItem, kgIndex) => {
            if (kgItem.type === "knowledge_graph_ai_overview_item") {
              if (kgItem.references && Array.isArray(kgItem.references)) {
                kgItem.references.forEach((ref, refIndex) => {
                  if (ref.domain) {
                    results.push({
                      domain: ref.domain,
                      url: ref.url || "",
                      title: ref.title || "",
                      snippet: ref.text || "",
                      mentionContext: `Knowledge Graph AI Overview ${kgIndex + 1}, Reference ${refIndex + 1}`,
                    });
                  }
                });
              }

              if (kgItem.items && Array.isArray(kgItem.items)) {
                kgItem.items.forEach((nestedItem, nestedIndex) => {
                  if (nestedItem.references && Array.isArray(nestedItem.references)) {
                    nestedItem.references.forEach((ref, refIndex) => {
                      if (ref.domain) {
                        results.push({
                          domain: ref.domain,
                          url: ref.url || "",
                          title: ref.title || "",
                          snippet: ref.text || "",
                          mentionContext: `Knowledge Graph AI Overview ${kgIndex + 1}, Nested Item ${nestedIndex + 1}, Reference ${refIndex + 1}`,
                        });
                      }
                    });
                  }
                });
              }
            }
          });
        }

        if (item.type === "people_also_ask" && item.items) {
          item.items.forEach((paaItem, paaIndex) => {
            if (paaItem.expanded_element && Array.isArray(paaItem.expanded_element)) {
              paaItem.expanded_element.forEach((expanded, expandedIndex) => {
                if (expanded.type === "people_also_ask_ai_overview_expanded_element") {
                  if (expanded.references && Array.isArray(expanded.references)) {
                    expanded.references.forEach((ref, refIndex) => {
                      if (ref.domain) {
                        results.push({
                          domain: ref.domain,
                          url: ref.url || "",
                          title: ref.title || "",
                          snippet: ref.text || "",
                          mentionContext: `People Also Ask ${paaIndex + 1}, AI Overview Reference ${refIndex + 1}`,
                        });
                      }
                    });
                  }
                }
              });
            }
          });
        }
      });
    } catch (error) {
      console.error("Error extracting DataForSEO AI Overview data:", error);
    }

    const uniqueResults = results.filter(
      (item, index, self) =>
        index === self.findIndex((t) => t.domain === item.domain)
    );

    return uniqueResults;
  }

  extractAiOverviewContent(dataForSeoResponse) {
    try {
      const tasks = dataForSeoResponse.tasks;
      if (!tasks || tasks.length === 0) return "";

      const result = tasks[0].result;
      if (!result || result.length === 0) return "";

      const items = result[0].items;
      if (!items || items.length === 0) return "";

      for (const item of items) {
        if (item.type === "ai_overview") {
          if (item.markdown) return item.markdown;
          if (item.text) return item.text;

          if (item.items && Array.isArray(item.items)) {
            const textParts = item.items
              .map((aiItem) => aiItem.text || aiItem.markdown || "")
              .filter(Boolean);
            return textParts.join(" ");
          }
        }
      }

      return "";
    } catch (error) {
      console.error("Error extracting AI Overview content:", error);
      return "";
    }
  }

  calculateRelevanceScore(title, snippet, keyword) {
    try {
      const text = `${title} ${snippet}`.toLowerCase();
      const keywordLower = keyword.toLowerCase();

      let score = 0;

      if (text.includes(keywordLower)) {
        score += 50;
      }

      const keywordWords = keywordLower.split(" ");
      keywordWords.forEach((word) => {
        if (text.includes(word)) {
          score += 10;
        }
      });

      return Math.min(score, 100);
    } catch (error) {
      return 50;
    }
  }

  calculateCompleteness(results) {
    if (results.length === 0) return 0;

    const completeResults = results.filter(
      (r) => r.domain && r.url && r.title && r.snippet
    );

    return Math.round((completeResults.length / results.length) * 100);
  }

  extractConfidenceScore(dataForSeoResponse) {
    try {
      return null;
    } catch (error) {
      return null;
    }
  }

  extractDataForSEOAiMode(dataForSeoResponse) {
    const results = [];

    try {
      const tasks = dataForSeoResponse.tasks;

      if (!tasks || tasks.length === 0) {
        return results;
      }

      const result = tasks[0].result;
      if (!result || result.length === 0) {
        return results;
      }

      const items = result[0].items;
      if (!items || items.length === 0) {
        return results;
      }

      items.forEach((item) => {
        if (item.type === "ai_overview") {
          if (item.references && Array.isArray(item.references)) {
            item.references.forEach((ref, index) => {
              if (ref.domain) {
                results.push({
                  domain: ref.domain,
                  url: ref.url || "",
                  title: ref.title || "",
                  snippet: ref.text || "",
                  mentionContext: `AI Mode Top-level Reference ${index + 1}`,
                });
              }
            });
          }

          if (item.items && Array.isArray(item.items)) {
            item.items.forEach((aiItem, itemIndex) => {
              if (aiItem.references && Array.isArray(aiItem.references)) {
                aiItem.references.forEach((ref, refIndex) => {
                  if (ref.domain) {
                    results.push({
                      domain: ref.domain,
                      url: ref.url || "",
                      title: ref.title || "",
                      snippet: ref.text || "",
                      mentionContext: `AI Mode Item ${itemIndex + 1}, Reference ${refIndex + 1}`,
                    });
                  }
                });
              }

              if (aiItem.links && Array.isArray(aiItem.links)) {
                aiItem.links.forEach((link, linkIndex) => {
                  if (link.domain) {
                    results.push({
                      domain: link.domain,
                      url: link.url || "",
                      title: link.title || "",
                      snippet: link.description || "",
                      mentionContext: `AI Mode Item ${itemIndex + 1}, Link ${linkIndex + 1}`,
                    });
                  }
                });
              }

              if (aiItem.type === "ai_overview_video_element" && aiItem.domain) {
                results.push({
                  domain: aiItem.domain,
                  url: aiItem.url || "",
                  title: aiItem.title || "",
                  snippet: aiItem.snippet || "",
                  mentionContext: `AI Mode Video ${itemIndex + 1}`,
                });
              }

              if (aiItem.type === "ai_overview_expanded_element" && aiItem.components) {
                aiItem.components.forEach((component, compIndex) => {
                  if (component.links && Array.isArray(component.links)) {
                    component.links.forEach((link, linkIndex) => {
                      if (link.domain) {
                        results.push({
                          domain: link.domain,
                          url: link.url || "",
                          title: link.title || "",
                          snippet: link.description || "",
                          mentionContext: `AI Mode Expanded Component ${compIndex + 1}, Link ${linkIndex + 1}`,
                        });
                      }
                    });
                  }

                  if (component.references && Array.isArray(component.references)) {
                    component.references.forEach((ref, refIndex) => {
                      if (ref.domain) {
                        results.push({
                          domain: ref.domain,
                          url: ref.url || "",
                          title: ref.title || "",
                          snippet: ref.text || "",
                          mentionContext: `AI Mode Expanded Component ${compIndex + 1}, Reference ${refIndex + 1}`,
                        });
                      }
                    });
                  }
                });
              }
            });
          }

          if (item.markdown) {
            const urlMatches = item.markdown.match(/\[([^\]]+)\]\(([^)]+)\)/g);
            if (urlMatches) {
              urlMatches.forEach((match, index) => {
                const urlMatch = match.match(/\[([^\]]+)\]\(([^)]+)\)/);
                if (urlMatch && urlMatch[2]) {
                  const url = urlMatch[2];
                  const title = urlMatch[1];
                  const domain = this.extractDomain(url);

                  if (domain) {
                    results.push({
                      domain: domain,
                      url: url,
                      title: title,
                      snippet: "",
                      mentionContext: `AI Mode Markdown Link ${index + 1}`,
                    });
                  }
                }
              });
            }
          }
        }
      });

      const resultData = result[0];
      if (resultData.ai_content) {
        const urlMatches = resultData.ai_content.match(
          /https?:\/\/(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s)"]*/g
        );
        if (urlMatches) {
          urlMatches.forEach((url, index) => {
            const domain = this.extractDomain(url);
            if (domain && !results.some((r) => r.domain === domain)) {
              results.push({
                domain: domain,
                url: url,
                title: "Mentioned in AI Mode content",
                snippet: this.extractContextAroundUrl(resultData.ai_content, url),
                mentionContext: `AI Mode Content URL ${index + 1}`,
              });
            }
          });
        }
      }
    } catch (error) {
      console.error("Error extracting DataForSEO AI Mode data:", error);
    }

    const uniqueResults = results.filter(
      (item, index, self) =>
        index === self.findIndex((t) => t.domain === item.domain)
    );

    return uniqueResults;
  }

  extractAiModeContent(dataForSeoResponse) {
    try {
      const tasks = dataForSeoResponse.tasks;
      if (!tasks || tasks.length === 0) return "";

      const result = tasks[0].result;
      if (!result || result.length === 0) return "";

      const resultData = result[0];

      if (resultData.ai_content) {
        return resultData.ai_content;
      }

      const items = resultData.items;
      if (!items || items.length === 0) return "";

      for (const item of items) {
        if (item.type === "ai_overview") {
          if (item.markdown) return item.markdown;

          if (item.items && Array.isArray(item.items)) {
            const textParts = item.items
              .map((aiItem) => aiItem.text || aiItem.markdown || "")
              .filter(Boolean);
            return textParts.join(" ");
          }
        }
      }

      return "";
    } catch (error) {
      console.error("Error extracting AI Mode content:", error);
      return "";
    }
  }

  extractDomain(url) {
    try {
      if (!url) return null;

      const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
      return urlObj.hostname.toLowerCase();
    } catch (error) {
      const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s?#]+)/);
      return match ? match[1].toLowerCase() : null;
    }
  }

  extractContextAroundUrl(content, url, contextLength = 100) {
    try {
      const index = content.indexOf(url);
      if (index === -1) return "";

      const start = Math.max(0, index - contextLength);
      const end = Math.min(content.length, index + url.length + contextLength);

      return content.substring(start, end).trim();
    } catch (error) {
      return "";
    }
  }

  async processChatGptData(keyword, userId, keywordId, month) {
    try {
      const prompt = `Search for "${keyword}" and provide top 10 website recommendations with their URLs. Be specific about websites and include actual URLs when possible.`;

      const response = await axios.post(
        this.chatGptConfig.baseURL,
        {
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 1200,
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${this.chatGptConfig.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      const chatResponse = response.data.choices[0].message.content;
      const results = this.extractDomainsFromChatGptResponse(chatResponse);

      await this.storeMonthlyAiData({
        userId,
        keywordId,
        keyword,
        month,
        carrier: "chatgpt",
        results,
        rawResponse: {
          content: chatResponse.substring(0, 2000),
          sources: results.map((r) => r.url),
          confidence: null,
        },
        totalResults: results.length,
      });

      return results;
    } catch (error) {
      console.error("Error processing ChatGPT data:", error);

      await this.storeMonthlyAiData({
        userId,
        keywordId,
        keyword,
        month,
        carrier: "chatgpt",
        results: [],
        rawResponse: {
          content: `Error: ${error.message}`,
          sources: [],
          confidence: null,
        },
        totalResults: 0,
      });

      return [];
    }
  }

  extractDomainsFromChatGptResponse(response) {
    const results = [];
    const foundDomains = new Set();

    const urlRegex = /https?:\/\/(www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/g;
    let match;
    while ((match = urlRegex.exec(response)) !== null) {
      const domain = this.extractDomain(match[0]);
      if (domain && !foundDomains.has(domain)) {
        foundDomains.add(domain);
        results.push({
          domain: domain,
          url: match[0],
          title: `Mentioned in ChatGPT response`,
          snippet: this.extractContextAroundDomain(response, match[0]),
          mentionContext: "URL recommendation by ChatGPT",
        });
      }
    }

    const domainRegex = /(?:^|\s|[^\w])([a-zA-Z0-9-]+\.[a-zA-Z]{2,})(?=\s|[^\w]|$)/g;
    while ((match = domainRegex.exec(response)) !== null) {
      const domain = this.extractDomain(match[1]);
      if (domain && !foundDomains.has(domain) && this.isValidDomain(domain)) {
        foundDomains.add(domain);
        results.push({
          domain: domain,
          url: `https://${match[1]}`,
          title: `Mentioned in ChatGPT response`,
          snippet: this.extractContextAroundDomain(response, match[1]),
          mentionContext: "Domain recommendation by ChatGPT",
        });
      }
    }

    const commonPatterns = [
      /(?:visit|check|go to|website|site)[\s:]*([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/gi,
      /([a-zA-Z0-9-]+\.(?:com|org|net|edu|gov|io|co))(?=\s|$|[^\w])/gi,
    ];

    commonPatterns.forEach((pattern) => {
      while ((match = pattern.exec(response)) !== null) {
        const domain = this.extractDomain(match[1]);
        if (domain && !foundDomains.has(domain) && this.isValidDomain(domain)) {
          foundDomains.add(domain);
          results.push({
            domain: domain,
            url: `https://${match[1]}`,
            title: `Mentioned in ChatGPT response`,
            snippet: this.extractContextAroundDomain(response, match[1]),
            mentionContext: "Pattern-based recommendation by ChatGPT",
          });
        }
      }
    });

    return results.slice(0, 10);
  }

  extractContextAroundDomain(text, domain) {
    const index = text.toLowerCase().indexOf(domain.toLowerCase());
    if (index === -1) return "";

    const start = Math.max(0, index - 100);
    const end = Math.min(text.length, index + domain.length + 100);
    return text.substring(start, end).trim();
  }

  async storeMonthlyAiData(data) {
    try {
      const filter = {
        userId: data.userId,
        keywordId: data.keywordId,
        month: data.month,
        carrier: data.carrier,
      };

      const update = {
        $set: {
          keyword: data.keyword,
          results: data.results,
          rawResponse: data.rawResponse,
          totalResults: data.totalResults,
          lastUpdated: new Date(),
          dataQuality: {
            completeness: data.results.length > 0 ? 100 : 0,
            freshness: new Date(),
          },
        },
      };

      const result = await MonthlyAiData.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
      });

      return result;
    } catch (error) {
      console.error(`Error storing ${data.carrier} AI data:`, error);
      console.error("Data being stored:", JSON.stringify(data, null, 2));
      throw error;
    }
  }

  async updateKeywordRanking(keyword, targetResult, itemTypes = [], aiData) {
    console.log(keyword, targetResult, itemTypes, aiData, "updateKeywordranking");
    console.log("targetResult:--------- ", targetResult);
    const currentRanking = {
      position: targetResult?.rank_group || 101,
      url: targetResult?.url || null,
      title: targetResult?.title || null,
      lastUpdated: new Date(),
      previousPosition: keyword.currentRanking?.position || 101,
      trend: this.calculateTrend(
        targetResult?.rank_group,
        keyword.currentRanking?.position
      ),
      serpFeatures: itemTypes,
      aiTracking: aiData,
    };

    await Keyword.findByIdAndUpdate(keyword._id, {
      currentRanking,
      tags: itemTypes,
    });
  }

  async updateMonthlyRanking(userId, keywordId, keyword, organicResults, itemTypes = []) {
    const currentMonth = MonthlyRanking.getCurrentMonth();

    let processedCount = 0;
    let newDocsCreated = 0;
    let updatedDocsCount = 0;

    console.log(`Starting monthly ranking update for ${organicResults.length} results`);

    const domainResultMap = new Map();

    for (const result of organicResults) {
      const domain = this.extractDomain(result.url || result.domain);
      if (!domain) continue;

      const existing = domainResultMap.get(domain);

      if (!existing || result.rank_group < existing.rank_group) {
        domainResultMap.set(domain, result);
      }
    }

    const uniqueOrganicResults = Array.from(domainResultMap.values());

    for (const result of uniqueOrganicResults) {
      const domain = this.extractDomain(result.url || result.domain);
      const position = result.rank_group || result.position;

      if (!domain) {
        console.log(`Skipping result - no domain found for:`, result);
        continue;
      }

      try {
        let monthlyRanking = await MonthlyRanking.findOne({
          userId,
          keywordId,
          domain,
        });

        if (monthlyRanking) {
          console.log(`Updating existing doc for domain: ${domain}, position: ${position}`);

          const previousPosition = monthlyRanking.currentPosition;

          let trend = "same";
          if (previousPosition && position) {
            if (position < previousPosition) trend = "up";
            else if (position > previousPosition) trend = "down";
          } else if (!previousPosition) {
            trend = "new";
          }

          monthlyRanking.rankings.push({
            month: currentMonth,
            position: position,
            previousPosition: previousPosition,
            url: result.url,
            title: result.title,
            trend: trend,
            serpFeatures: itemTypes,
            checkedAt: new Date(),
          });

          monthlyRanking.currentMonth = currentMonth;
          monthlyRanking.currentPosition = position;
          monthlyRanking.lastUpdated = new Date();

          if (position <= 100) {
            monthlyRanking.currentStatus = "ranked";
          } else {
            monthlyRanking.currentStatus = "not_ranked";
          }

          await monthlyRanking.save();
          updatedDocsCount++;
        } else {
          console.log(`Creating new doc for domain: ${domain}, position: ${position}`);

          monthlyRanking = new MonthlyRanking({
            userId,
            keywordId,
            domain,
            keyword,
            currentMonth: currentMonth,
            currentPosition: position,
            currentStatus: position <= 100 ? "ranked" : "not_ranked",
            rankings: [
              {
                month: currentMonth,
                position: position,
                previousPosition: null,
                url: result.url,
                title: result.title,
                trend: "new",
                serpFeatures: itemTypes,
                checkedAt: new Date(),
              },
            ],
            createdAt: new Date(),
            lastUpdated: new Date(),
          });

          await monthlyRanking.save();
          newDocsCreated++;
        }

        processedCount++;
      } catch (error) {
        console.error(`Error processing ranking for domain ${domain}:`, error);
        continue;
      }
    }

    console.log(`Monthly ranking update completed:
    - Total processed: ${processedCount}
    - New docs created: ${newDocsCreated}
    - Existing docs updated: ${updatedDocsCount}
    - Rankings array length increased by 1 for all ${updatedDocsCount} existing docs`);

    return {
      processedCount,
      newDocsCreated,
      updatedDocsCount,
      totalResults: organicResults.length,
    };
  }

  async updateCompetitorStats(competitorId, position, aiData) {
    const competitor = await Competitor.findById(competitorId);
    if (!competitor) return;

    const distribution = competitor.stats.positionDistribution;
    if (position <= 3) distribution.top3++;
    else if (position <= 10) distribution.top10++;
    else if (position <= 20) distribution.top20++;
    else if (position <= 50) distribution.top50++;
    else if (position <= 100) distribution.top100++;

    if (aiData.googleAiOverview) competitor.stats.aiMentions.googleAiOverview++;
    if (aiData.googleAiMode) competitor.stats.aiMentions.googleAiMode++;
    if (aiData.chatgptIncluded) competitor.stats.aiMentions.chatgpt++;

    competitor.stats.lastAnalyzed = new Date();
    await competitor.save();
  }

  async saveSerpSnapshot(task, serpResults, itemTypes = []) {
    const currentMonth = MonthlyRanking.getCurrentMonth();

    const snapshot = new SerpSnapshot({
      userId: task.userId,
      keywordId: task.keywordId,
      keyword: task.requestData.keyword,
      month: currentMonth,
      searchParameters: {
        location: task.requestData.location,
        device: task.requestData.device,
        language: "en",
        searchEngine: "google",
      },
      totalResults: serpResults.total_count,
      serpFeatures: {
        itemTypes: itemTypes,
        featuredSnippet: {
          isPresent: itemTypes.includes("featured_snippet"),
          ownedBy: serpResults.featured_snippet
            ? this.extractDomain(serpResults.featured_snippet.url)
            : null,
        },
        localPack: itemTypes.includes("local_pack"),
        peopleAlsoAsk: itemTypes.includes("people_also_ask"),
        relatedSearches: itemTypes.includes("related_searches"),
        shoppingResults: itemTypes.includes("shopping"),
        videoResults: itemTypes.includes("video"),
        imageResults: itemTypes.includes("images"),
        knowledgeGraph: itemTypes.includes("knowledge_graph"),
        googleFlights: itemTypes.includes("google_flights"),
        googleHotels: itemTypes.includes("google_hotels"),
        jobs: itemTypes.includes("jobs"),
        answerBox: itemTypes.includes("answer_box"),
        aiOverview: itemTypes.includes("ai_overview"),
      },
      organicResults: (serpResults.items || []).slice(0, 100).map((item) => ({
        position: item.rank_group,
        domain: this.extractDomain(item.url),
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        isTargetDomain:
          this.extractDomain(item.url) === task.requestData.targetDomain,
        isCompetitor: false,
      })),
    });

    await snapshot.save();
  }

  async getKeywordsForUpdate() {
    const now = new Date();

    const keywords = await Keyword.find({
      isActive: true,
      $or: [
        { isDataFetched: false },
        { nextScheduledCheck: { $lte: now } },
      ],
    }).populate("userId");

    return keywords;
  }

  calculateNextCheck() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    nextMonth.setHours(2, 0, 0, 0);
    return nextMonth;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  findTargetDomainResult(organicResults, targetDomain) {
    return organicResults.find(
      // (item) => this.extractDomain(item.url) === targetDomain
      (item) => this.cleanDomain(item.url) === targetDomain
    );
  }

  extractMentionedDomains(content) {
    if (!content) return [];

    const domainRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/g;
    const matches = content.match(domainRegex) || [];

    return [
      ...new Set(
        matches.map((domain) =>
          domain.replace(/^https?:\/\//, "").replace(/^www\./, "")
        )
      ),
    ];
  }

  calculateTrend(currentPosition, previousPosition) {
    if (!previousPosition || !currentPosition) return "new";
    if (currentPosition < previousPosition) return "up";
    if (currentPosition > previousPosition) return "down";
    return "same";
  }

  async getKeywordSuggestions(userId, seedKeywords, limit = 100) {
    try {
      const payload = [
        {
          keywords: Array.isArray(seedKeywords) ? seedKeywords : [seedKeywords],
          location_code: 2840,
          language_code: "en",
          limit: limit,
          offset: 0,
          order_by: ["search_volume,desc"],
        },
      ];

      const trackingTaskId = `keywords_${Date.now()}`;

      const usageRecord = await DataForSeoUsageTracker.trackApiCall({
        taskId: trackingTaskId,
        userId: userId,
        keywordId: null,
        endpoint: "keywords_data_google_keyword_ideas_live",
        requestData: {
          keywords: Array.isArray(seedKeywords) ? seedKeywords : [seedKeywords],
          location_code: 2840,
          language_code: "en",
          limit: limit,
        },
        apiType: "Keywords Data",
      });

      const response = await axios({
        method: "post",
        url: this.serpApiConfig.baseURL + "/v3/keywords_data/google_ads/keywords_for_keywords/live",
        auth: {
          username: this.serpApiConfig.username,
          password: this.serpApiConfig.password,
        },
        data: payload,
        headers: {
          "content-type": "application/json",
        },
        timeout: 30000,
      });

      if (response.data && response.data.tasks && response.data.tasks[0]) {
        const task = response.data.tasks[0];

        if (task.status_code === 20000 && task.result) {
          if (usageRecord) {
            await DataForSeoUsageTracker.updateApiCallResult(
              trackingTaskId,
              {
                totalResults: task.result?.length || 0,
                cost: task.cost || 0,
                statusCode: task.status_code,
              },
              "success"
            );
          }

          const keywords = task.result || [];

          return keywords.map((item) => ({
            keyword: item.keyword,
            source: "dataforseo_keywords",
            search_volume: item.search_volume || 0,
            competition: item.competition || 0,
          }));
        } else {
          if (usageRecord) {
            await DataForSeoUsageTracker.updateApiCallResult(
              trackingTaskId,
              {
                statusCode: task.status_code,
                statusMessage: task.status_message,
                cost: task.cost || 0,
              },
              "failed",
              { message: task.status_message, code: task.status_code }
            );
          }

          console.error("DataForSEO Keywords API error:", task.status_message);
          return [];
        }
      }

      return [];
    } catch (error) {
      console.error("Error calling DataForSEO Keywords API:", error);

      const trackingTaskId = `keywords_${Date.now()}`;
      await DataForSeoUsageTracker.updateApiCallResult(
        trackingTaskId,
        null,
        "failed",
        { message: error.message, code: error.code }
      );

      return [];
    }
  }

  isValidDomain(domain) {
    if (!domain || domain.length < 4) return false;

    const blacklist = [
      "example.com",
      "test.com",
      "localhost",
      "domain.com",
      "website.com",
    ];
    if (blacklist.includes(domain.toLowerCase())) return false;

    const domainPattern = /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/;
    return domainPattern.test(domain);
  }

  getSerpFeatureInsights(itemTypes) {
    const insights = {
      competitiveness: "low",
      commercialIntent: "low",
      difficulty: "low",
      features: [],
    };

    const commercialFeatures = [
      "shopping",
      "paid",
      "google_flights",
      "google_hotels",
      "local_pack",
    ];
    const commercialCount = itemTypes.filter((type) =>
      commercialFeatures.includes(type)
    ).length;

    if (commercialCount >= 3) {
      insights.commercialIntent = "high";
    } else if (commercialCount >= 1) {
      insights.commercialIntent = "medium";
    }

    const competitiveFeatures = [
      "featured_snippet",
      "knowledge_graph",
      "answer_box",
      "ai_overview",
    ];
    const competitiveCount = itemTypes.filter((type) =>
      competitiveFeatures.includes(type)
    ).length;

    if (competitiveCount >= 2) {
      insights.competitiveness = "high";
      insights.difficulty = "high";
    } else if (competitiveCount >= 1) {
      insights.competitiveness = "medium";
      insights.difficulty = "medium";
    }

    const featureDescriptions = {
      featured_snippet: "Featured snippet present - opportunity for position 0",
      knowledge_graph: "Knowledge graph present - high competition",
      local_pack: "Local pack present - local SEO opportunity",
      shopping: "Shopping results present - commercial intent",
      people_also_ask: "People Also Ask present - FAQ opportunity",
      ai_overview: "AI Overview present - new SERP feature",
      video: "Video results present - video content opportunity",
      images: "Image results present - visual content opportunity",
    };

    insights.features = itemTypes.map((type) => ({
      type,
      description: featureDescriptions[type] || `${type} feature present`,
    }));

    return insights;
  }
}

module.exports = RankTrackerService;