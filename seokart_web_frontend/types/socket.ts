// types/socket.ts
export interface UserActivity {
  _id: string;
  userId: string;
  websiteUrl: string;
  status: 'processing' | 'completed' | 'failed' | 'completed_with_errors';
  progress: number;
  isSitemapCrawling: number;
  isWebpageCrawling: number;
  isBacklinkFetching: number;
  sitemapCount: number;
  webpageCount: number;
  webpagesSuccessful: number;
  webpagesFailed: number;
  startTime: string;
  endTime?: string;
  lastCrawlStarted: string;
  crawlCount: number;
  estimatedTimeRemaining: number;
  errorMessages: string[];
  backlinkSummaryStatus?: string;
  backlinkError?: string;
}

export interface ActivityProgressUpdate {
  activityId: string;
  websiteUrl: string;
  status: string;
  progress: number;
  isSitemapCrawling: number;
  isWebpageCrawling: number;
  isBacklinkFetching: number;
  sitemapCount: number;
  webpageCount: number;
  webpagesSuccessful: number;
  webpagesFailed: number;
  startTime: string;
  endTime?: string;
  estimatedTimeRemaining: number;
  errorMessages: string[];
  timestamp: string;
}

export interface CrawlStartedEvent {
  activityId: string;
  websiteUrl: string;
  status: string;
  sitemapCount: number;
  crawlCount: number;
  isNewCrawl: boolean;
  message: string;
  timestamp: string;
}

export interface CrawlCompletedEvent {
  activityId: string;
  websiteUrl: string;
  status: string;
  totalSitemaps: number;
  totalWebpages: number;
  savedPages: number;
  failedPages: number;
  progress: number;
  endTime: string;
  timestamp: string;
}

export interface CrawlErrorEvent {
  websiteUrl: string;
  message: string;
  activityId: string;
  timestamp: string;
}

export interface UserActivitiesResponse {
  success: boolean;
  count: number;
  data: UserActivity[];
  timestamp: string;
}

export interface ActivityStatusResponse {
  success: boolean;
  activityId: string;
  status: string;
  progress: number;
  isSitemapCrawling: number;
  isWebpageCrawling: number;
  isBacklinkFetching: number;
  sitemapCount: number;
  webpageCount: number;
  webpagesSuccessful: number;
  webpagesFailed: number;
  startTime: string;
  endTime?: string;
  errorMessages: string[];
  estimatedTimeRemaining: number;
  websiteUrl: string;
}

export interface RealTimeUpdate {
  type: 'progress' | 'started' | 'completed' | 'error';
  timestamp: string;
  message: string;
  data: any;
}

export type SocketConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';