const { UserPlan } = require('../models/userPlan');
const { RankTrackerActivity } = require('../models/rankTracker');

class UserPlanController {
  
  // Create initial user plan (called after user signup)
  static async createUserPlan(req, res) {
    try {
      const userId = req.user.id;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      // Check if plan already exists
      const existingPlan = await UserPlan.findOne({ userId });
      if (existingPlan) {
        return res.status(400).json({
          success: false,
          message: 'User plan already exists',
          data: existingPlan
        });
      }

      // Create default free plan
      const userPlan = new UserPlan({
        userId,
        domains: [], // Initialize empty domains array
        activeDomain: null,
        rankTracker: {
          plan: 'free',
          limits: {
            domains: 1,
            keywords: 3,
            competitors: 3,
            updateFrequency: 'monthly',
            aiTracking: false,
            historicalMonths: 3
          },
          usage: {
            domainsUsed: 0,
            keywordsUsed: 0,
            competitorsUsed: 0,
            updatesThisMonth: 0
          }
        },
        webCrawler: {
          plan: 'free',
          limits: {
            pagesPerMonth: 100,
            concurrentCrawls: 1,
            dataRetentionDays: 30
          },
          usage: {
            pagesThisMonth: 0,
            activeCrawls: 0
          }
        },
        subscription: {
          status: 'trial',
          startDate: new Date()
        },
        features: {
          betaFeatures: false,
          apiAccess: false,
          whiteLabel: false,
          prioritySupport: false
        }
      });
 
      await userPlan.save();

      res.status(201).json({
        success: true,
        message: 'User plan created successfully',
        data: userPlan
      });

    } catch (error) {
      console.error('Error creating user plan:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Get user plan
  static async getUserPlan(req, res) {
    try {
      const userId = req.user.id;

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: 'User plan not found'
        });
      }

      res.status(200).json({
        success: true,
        data: {
          ...userPlan.toObject(),
          activeDomainDetails: userPlan.getActiveDomain(),
          allDomains: userPlan.getAllDomains()
        }
      });

    } catch (error) {
      console.error('Error fetching user plan:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Add domain to user plan
  static async addDomain(req, res) {
    try {
      const userId = req.user.id;
      const { domain, setAsActive = false } = req.body;


      if (!domain) {
        return res.status(400).json({
          success: false,
          message: 'Domain is required'
        });
      }

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: 'User plan not found'
        });
      }

      try {
        await userPlan.addDomain(domain, setAsActive);


        res.status(201).json({
          success: true,
          message: 'Domain added successfully',
          data: {
            domains: userPlan.getAllDomains(),
            activeDomain: userPlan.getActiveDomain(),
            limits: userPlan.rankTracker.limits
          }
        });

      } catch (domainError) {
        return res.status(400).json({
          success: false,
          message: domainError.message
        });
      }

    } catch (error) {
      console.error('Error adding domain:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Set active domain
  static async setActiveDomain(req, res) {
    try {
      const userId = req.user.id;
      const { domain } = req.body;

      if (!domain) {
        return res.status(400).json({
          success: false,
          message: 'Domain is required'
        });
      }

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: 'User plan not found'
        });
      }

      try {
        await userPlan.setActiveDomain(domain);


        res.status(200).json({
          success: true,
          message: 'Active domain updated successfully',
          data: {
            activeDomain: userPlan.getActiveDomain(),
            allDomains: userPlan.getAllDomains()
          }
        });

      } catch (domainError) {
        return res.status(400).json({
          success: false,
          message: domainError.message
        });
      }

    } catch (error) {
      console.error('Error setting active domain:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Remove domain
  static async removeDomain(req, res) {
    try {
            const userId = req.user.id;
      const { domain } = req.params;

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: 'User plan not found'
        });
      }

      try {
        await userPlan.removeDomain(domain);

        // Log activity
        await RankTrackerActivity.create({
          userId,
          action: 'domain_removed',
          details: {
            domain: domain
          },
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            source: 'web'
          }
        });

        res.status(200).json({
          success: true,
          message: 'Domain removed successfully',
          data: {
            domains: userPlan.getAllDomains(),
            activeDomain: userPlan.getActiveDomain()
          }
        });

      } catch (domainError) {
        return res.status(400).json({
          success: false,
          message: domainError.message
        });
      }

    } catch (error) {
      console.error('Error removing domain:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Get user domains
  static async getUserDomains(req, res) {
    try {
      const  userId = req.user.id;

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: 'User plan not found'
        });
      }

      res.status(200).json({
        success: true,
        data: {
          domains: userPlan.getAllDomains(),
          activeDomain: userPlan.getActiveDomain(),
          limits: {
            maxDomains: userPlan.rankTracker.limits.domains,
            currentCount: userPlan.domains.length
          }
        }
      });

    } catch (error) {
      console.error('Error fetching user domains:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Update user plan (upgrade/downgrade)
  static async updateUserPlan(req, res) {
    try {
      const userId = req.user.id;
      const { service, plan, billingInfo } = req.body;

      // Validate inputs
      if (!service || !plan) {
        return res.status(400).json({
          success: false,
          message: 'Service and plan are required'
        });
      }

      const validServices = ['rankTracker', 'webCrawler'];
      const validPlans = {
        rankTracker: ['free', 'basic', 'premium', 'enterprise'],
        webCrawler: ['free', 'basic', 'premium']
      };

      if (!validServices.includes(service)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid service. Must be rankTracker or webCrawler'
        });
      }

      if (!validPlans[service].includes(plan)) {
        return res.status(400).json({
          success: false,
          message: `Invalid plan for ${service}. Valid plans: ${validPlans[service].join(', ')}`
        });
      }

      // Find user plan
      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: 'User plan not found'
        });
      }

      const previousPlan = userPlan[service].plan;

      // Check if downgrading would exceed new limits
      if (service === 'rankTracker') {
        const planLimits = {
          free: { domains: 1, keywords: 3, competitors: 3 },
          basic: { domains: 3, keywords: 50, competitors: 10 },
          premium: { domains: 10, keywords: 200, competitors: 25 },
          enterprise: { domains: -1, keywords: -1, competitors: -1 }
        };

        const newLimits = planLimits[plan];
        const currentUsage = userPlan.rankTracker.usage;

        // Check domain limit
        if (newLimits.domains !== -1 && userPlan.domains.length > newLimits.domains) {
          return res.status(400).json({
            success: false,
            message: `Cannot downgrade: You have ${userPlan.domains.length} domains but the ${plan} plan allows only ${newLimits.domains}. Please remove some domains first.`
          });
        }

        // Check other limits
        if (newLimits.keywords !== -1 && currentUsage.keywordsUsed > newLimits.keywords) {
          return res.status(400).json({
            success: false,
            message: `Cannot downgrade: You are using ${currentUsage.keywordsUsed} keywords but the ${plan} plan allows only ${newLimits.keywords}.`
          });
        }

        if (newLimits.competitors !== -1 && currentUsage.competitorsUsed > newLimits.competitors) {
          return res.status(400).json({
            success: false,
            message: `Cannot downgrade: You are tracking ${currentUsage.competitorsUsed} competitors but the ${plan} plan allows only ${newLimits.competitors}.`
          });
        }
      }

      // Update plan using schema method
      await userPlan.changePlan(service, plan);

      // Update billing info if provided
      if (billingInfo) {
        if (billingInfo.paymentMethod) {
          userPlan.subscription.paymentMethod = billingInfo.paymentMethod;
        }
        if (billingInfo.status) {
          userPlan.subscription.status = billingInfo.status;
        }
        if (billingInfo.endDate) {
          userPlan.subscription.endDate = new Date(billingInfo.endDate);
        }
        if (billingInfo.nextBillingDate) {
          userPlan.subscription.nextBillingDate = new Date(billingInfo.nextBillingDate);
        }
        if (billingInfo.amount) {
          userPlan.subscription.amount = billingInfo.amount;
        }
        if (billingInfo.currency) {
          userPlan.subscription.currency = billingInfo.currency;
        }
        
        await userPlan.save();
      }

      // Update features based on plan
      if (service === 'rankTracker') {
        userPlan.features.apiAccess = ['premium', 'enterprise'].includes(plan);
        userPlan.features.prioritySupport = ['premium', 'enterprise'].includes(plan);
        userPlan.features.whiteLabel = plan === 'enterprise';
        await userPlan.save();
      }

      // Log activity
      const actionType = UserPlanController.getPlanChangeAction(previousPlan, plan);
      await RankTrackerActivity.create({
        userId,
        action: actionType,
        details: {
          service: service,
          previousPlan: previousPlan,
          newPlan: plan
        },
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          source: 'web'
        }
      });

      res.status(200).json({
        success: true,
        message: `${service} plan updated successfully`,
        data: {
          userId,
          service,
          previousPlan,
          currentPlan: plan,
          limits: userPlan[service].limits,
          features: userPlan.features,
          subscription: userPlan.subscription,
          domains: userPlan.getAllDomains(),
          activeDomain: userPlan.getActiveDomain()
        }
      });

    } catch (error) {
      console.error('Error updating user plan:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Update usage (internal method for services)
  static async updateUsage(req, res) {
    try {
      const userId = req.user.id;
      const { service, resource, amount = 1, operation = 'increment' } = req.body;

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: 'User plan not found'
        });
      }

      // Check if operation would exceed limits
      if (operation === 'increment' && service === 'rankTracker') {
        const wouldExceed = userPlan.hasReachedRankTrackerLimit(resource);
        if (wouldExceed) {
          return res.status(400).json({
            success: false,
            message: `${resource} limit reached for current plan`,
            data: {
              current: resource === 'domains' ? userPlan.domains.length : userPlan.rankTracker.usage[`${resource}Used`],
              limit: userPlan.rankTracker.limits[resource]
            }
          });
        }
      }

      // Update usage
      if (operation === 'increment') {
        await userPlan.incrementUsage(service, resource, amount);
      } else if (operation === 'decrement') {
        await userPlan.incrementUsage(service, resource, -amount);
      }

      res.status(200).json({
        success: true,
        message: 'Usage updated successfully',
        data: {
          service,
          resource,
          usage: userPlan[service].usage,
          limits: userPlan[service].limits,
          domains: resource === 'domains' ? userPlan.getAllDomains() : undefined
        }
      });

    } catch (error) {
      console.error('Error updating usage:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Check if user can perform action
  static async checkLimits(req, res) {
    try {
      const userId = req.user.id;
      const { service, resource } = req.query;

      const userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        return res.status(404).json({
          success: false,
          message: 'User plan not found'
        });
      }

      let canPerform = true;
      let reason = '';

      if (service === 'rankTracker') {
        if (resource) {
          canPerform = !userPlan.hasReachedRankTrackerLimit(resource);
          if (!canPerform) {
            reason = `${resource} limit reached`;
          }
        }

        // Check update frequency
        if (resource === 'update') {
          canPerform = userPlan.canUpdateRankings();
          if (!canPerform) {
            reason = 'Update frequency limit reached';
          }
        }

        // Check AI tracking access
        if (resource === 'aiTracking') {
          canPerform = userPlan.canAccessAiTracking();
          if (!canPerform) {
            reason = 'AI tracking not available in current plan';
          }
        }
      }

      res.status(200).json({
        success: true,
        data: {
          canPerform,
          reason,
          usage: userPlan[service]?.usage,
          limits: userPlan[service]?.limits,
          features: userPlan.features,
          domains: userPlan.getAllDomains(),
          activeDomain: userPlan.getActiveDomain()
        }
      });

    } catch (error) {
      console.error('Error checking limits:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Reset monthly usage (called by cron job)
  static async resetMonthlyUsage(req, res) {
    try {
      const result = await UserPlan.updateMany(
        {},
        {
          $set: {
            'rankTracker.usage.updatesThisMonth': 0,
            'webCrawler.usage.pagesThisMonth': 0
          }
        }
      );

      res.status(200).json({
        success: true,
        message: 'Monthly usage reset successfully',
        data: {
          modifiedCount: result.modifiedCount
        }
      });

    } catch (error) {
      console.error('Error resetting monthly usage:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Get plan comparison/pricing info
  static async getPlanInfo(req, res) {
    try {
      const planDetails = {
        rankTracker: {
          free: {
            name: 'Free',
            price: 0,
            currency: 'USD',
            billing: 'monthly',
            limits: {
              domains: 1,
              keywords: 3,
              competitors: 3,
              updateFrequency: 'monthly',
              aiTracking: false,
              historicalMonths: 3
            },
            features: ['Basic keyword tracking', 'Monthly updates', '3 months history']
          },
          basic: {
            name: 'Basic',
            price: 29,
            currency: 'USD',
            billing: 'monthly',
            limits: {
              domains: 3,
              keywords: 50,
              competitors: 3,
              updateFrequency: 'monthly',
              aiTracking: true,
              historicalMonths: 6
            },
            features: ['AI tracking', 'Monthly updates', '12 months history', 'Email reports']
          },
          premium: {
            name: 'Premium',
            price: 79,
            currency: 'USD',
            billing: 'monthly',
            limits: {
              domains: 10,
              keywords: 200,
              competitors: 3,
              updateFrequency: 'monthly',
              aiTracking: true,
              historicalMonths: 12
            },
            features: ['Daily updates', '12 months history', 'API access', 'Priority support', 'Custom reports']
          },
          enterprise: {
            name: 'Enterprise',
            price: 199,
            currency: 'USD',
            billing: 'monthly',
            limits: {
              domains: -1, // unlimited
              keywords: -1,
              competitors: -1,
              updateFrequency: 'monthly',
              aiTracking: true,
              historicalMonths: 24
            },
            features: ['Unlimited everything', 'White label', '2 year history', 'Dedicated support', 'Custom integrations']
          }
        },
        webCrawler: {
          free: {
            name: 'Free',
            price: 0,
            limits: { pagesPerMonth: 100, concurrentCrawls: 1, dataRetentionDays: 30 }
          },
          basic: {
            name: 'Basic',
            price: 19,
            limits: { pagesPerMonth: 5000, concurrentCrawls: 3, dataRetentionDays: 90 }
          },
          premium: {
            name: 'Premium',
            price: 49,
            limits: { pagesPerMonth: 50000, concurrentCrawls: 10, dataRetentionDays: 365 }
          }
        }
      };

      res.status(200).json({
        success: true,
        data: planDetails
      });

    } catch (error) {
      console.error('Error fetching plan info:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Helper method to determine plan change action type
  static getPlanChangeAction(previousPlan, newPlan) {
    const planHierarchy = ['free', 'basic', 'premium', 'enterprise'];
    const prevIndex = planHierarchy.indexOf(previousPlan);
    const newIndex = planHierarchy.indexOf(newPlan);
    
    if (newIndex > prevIndex) {
      return 'plan_upgraded';
    } else if (newIndex < prevIndex) {
      return 'plan_downgraded';
    } else {
      return 'plan_updated';
    }
  }
}

module.exports = UserPlanController;