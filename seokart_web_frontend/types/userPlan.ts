// types/userPlan.ts

export interface DomainInfo {
  domain: string;
  isActive: boolean;
  addedAt: Date;
  settings?: {
    trackingEnabled: boolean;
    notifications: boolean;
  };
}

export interface PlanLimits {
  domains: number;
  keywords: number;
  competitors: number;
  updateFrequency: 'monthly' | 'weekly' | 'daily';
  aiTracking: boolean;
  historicalWeeks: number;
}

export interface PlanUsage {
  domainsUsed: number;
  keywordsUsed: number;
  competitorsUsed: number;
  updatesThisMonth: number;
}

export interface WebCrawlerLimits {
  pagesPerMonth: number;
  concurrentCrawls: number;
  dataRetentionDays: number;
}

export interface WebCrawlerUsage {
  pagesThisMonth: number;
  activeCrawls: number;
}

export interface RankTrackerPlan {
  plan: 'free' | 'basic' | 'premium' | 'enterprise';
  limits: PlanLimits;
  usage: PlanUsage;
}

export interface WebCrawlerPlan {
  plan: 'free' | 'basic' | 'premium';
  limits: WebCrawlerLimits;
  usage: WebCrawlerUsage;
}

export interface Subscription {
  status: 'trial' | 'active' | 'inactive' | 'cancelled';
  startDate: Date;
  endDate?: Date;
  nextBillingDate?: Date;
  paymentMethod?: string;
  amount?: number;
  currency?: string;
}

export interface Features {
  betaFeatures: boolean;
  apiAccess: boolean;
  whiteLabel: boolean;
  prioritySupport: boolean;
}

export interface UserPlan {
  _id?: string;
  userId: string;
  domains: DomainInfo[];
  activeDomain?: string;
  activeDomainDetails?: DomainInfo;
  allDomains?: DomainInfo[];
  rankTracker: RankTrackerPlan;
  webCrawler: WebCrawlerPlan;
  subscription: Subscription;
  features: Features;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RankTrackerPlanDetails {
  name: string;
  price: number;
  currency: string;
  billing: string;
  limits: PlanLimits;
  features: string[];
}

export interface WebCrawlerPlanDetails {
  name: string;
  price: number;
  limits: WebCrawlerLimits;
  currency?: string;
  billing?: string;
  features?: string[];
}

export interface PlanInfo {
  rankTracker: Record<string, RankTrackerPlanDetails>;
  webCrawler: Record<string, WebCrawlerPlanDetails>;
}

export interface UpdatePlanRequest {
  service: 'rankTracker' | 'webCrawler';
  plan: string;
  billingInfo?: {
    paymentMethod?: string;
    status?: string;
    endDate?: string;
    nextBillingDate?: string;
    amount?: number;
    currency?: string;
  };
}

export interface CreatePlanWithDomainRequest {
  domain: string;
  setAsActive?: boolean;
}

export interface UsageUpdateRequest {
  service: 'rankTracker' | 'webCrawler';
  resource: string;
  amount?: number;
  operation?: 'increment' | 'decrement';
}

export interface LimitsCheckResponse {
  canPerform: boolean;
  reason: string;
  usage: PlanUsage | WebCrawlerUsage;
  limits: PlanLimits | WebCrawlerLimits;
  features: Features;
  domains?: DomainInfo[];
  activeDomain?: DomainInfo;
}

export interface DomainOperationResponse {
  domains: DomainInfo[];
  activeDomain?: DomainInfo;
  allDomains?: DomainInfo[];
  limits?: {
    maxDomains: number;
    currentCount: number;
  };
}