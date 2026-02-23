import { RootState } from '../index';

export const selectUserPlan = (state: RootState) => state.userPlan;
export const selectPlanInfo = (state: RootState) => state.userPlan.planInfo;
export const selectUserPlanLoading = (state: RootState) => state.userPlan.loading;
export const selectUserPlanError = (state: RootState) => state.userPlan.error;

export const selectCanPerformAction = (state: RootState, service: string, resource: string): boolean => {
  const userPlan = state.userPlan.userPlan;
  if (!userPlan) return false;

  if (service === 'rankTracker') {
    const limits = userPlan?.rankTracker?.limits;
    const usage = userPlan?.rankTracker?.usage;

    switch (resource) {
      case 'domains':
        return limits.domains === -1 || usage.domainsUsed < limits.domains;
      case 'keywords':
        return limits.keywords === -1 || usage.keywordsUsed < limits.keywords;
      case 'competitors':
        return limits.competitors === -1 || usage.competitorsUsed < limits.competitors;
      case 'aiTracking':
        return limits.aiTracking;
      default:
        return true;
    }
  }

  if (service === 'webCrawler') {
    const limits = userPlan.webCrawler.limits;
    const usage = userPlan.webCrawler.usage;

    switch (resource) {
      case 'pages':
        return usage.pagesThisMonth < limits.pagesPerMonth;
      case 'crawls':
        return usage.activeCrawls < limits.concurrentCrawls;
      default:
        return true;
    }
  }

  return false;
};

export const selectRankTrackerUsagePercentage = (
  state: RootState,
  resource: 'domains' | 'keywords' | 'competitors'
): number => {
  const userPlan = state.userPlan.userPlan;
  if (!userPlan) return 0;

  const limits = userPlan.rankTracker.limits;
  const usage = userPlan.rankTracker.usage;

  const limit = limits[resource];
  const used = usage[`${resource}Used`];

  if (limit === -1) return 0;
  if (limit === 0) return 100;

  return Math.round((used / limit) * 100);
};

export const selectWebCrawlerUsagePercentage = (state: RootState, resource: 'pages'): number => {
  const userPlan = state.userPlan.userPlan;
  if (!userPlan) return 0;

  const limits = userPlan.webCrawler.limits;
  const usage = userPlan.webCrawler.usage;

  if (resource === 'pages') {
    const limit = limits.pagesPerMonth;
    const used = usage.pagesThisMonth;

    if (limit === 0) return 100;
    return Math.round((used / limit) * 100);
  }

  return 0;
};

export const selectIsLimitReached = (
  state: RootState,
  service: 'rankTracker' | 'webCrawler',
  resource: string
): boolean => {
  const userPlan = state.userPlan.userPlan;
  if (!userPlan) return true;

  if (service === 'rankTracker') {
    const limits = userPlan.rankTracker.limits;
    const usage = userPlan.rankTracker.usage;

    switch (resource) {
      case 'domains':
        return limits.domains !== -1 && usage.domainsUsed >= limits.domains;
      case 'keywords':
        return limits.keywords !== -1 && usage.keywordsUsed >= limits.keywords;
      case 'competitors':
        return limits.competitors !== -1 && usage.competitorsUsed >= limits.competitors;
      default:
        return false;
    }
  }

  if (service === 'webCrawler') {
    const limits = userPlan.webCrawler.limits;
    const usage = userPlan.webCrawler.usage;

    switch (resource) {
      case 'pages':
        return usage.pagesThisMonth >= limits.pagesPerMonth;
      case 'crawls':
        return usage.activeCrawls >= limits.concurrentCrawls;
      default:
        return false;
    }
  }

  return false;
};