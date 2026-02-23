export interface Activity {
  id: string;
  userId: string;
  websiteUrl: string;
  status: 'idle' | 'processing' | 'completed' | 'failed';
  progress: number;
  isSitemapCrawling: boolean;
  isWebpageCrawling: boolean;
  isBacklinkFetching: boolean;
  sitemapCount: number;
  webpageCount: number;
  webpagesSuccessful: number;
  webpagesFailed: number;
  estimatedTimeRemaining: number;
  errorMessages: string[];
  startTime?: Date;
  endTime?: Date;
  lastCrawlStarted?: Date;
  crawlCount: number;
  lastUpdate?: Date;
}

export interface CrawlRequest {
  websiteUrl: string;
  concurrency?: number;
  forceRecrawl?: boolean;
}

export interface CrawlResponse {
  success: boolean;
  message: string;
  activityId?: string;
  status?: string;
  crawlCount?: number;
  lastCrawlStarted?: string;
  isNewCrawl?: boolean;
  sitemapCount?: number;
  backlinkSummary?: {
    hasBacklinkData: boolean;
    backlinks?: number;
    refdomains?: number;
    lastFetched?: string;
    dominatingAnchor?: string;
    message?: string;
  };
}