export interface CrawlResult {
  id: string;
  url: string;
  status: 'pending' | 'crawling' | 'completed' | 'failed';
  pagesFound?: number;
  errors?: string[];
  startedAt: Date;
  completedAt?: Date;
  metadata?: {
    title?: string;
    description?: string;
    totalPages?: number;
  };
}

export interface CrawlerState {
  crawls: CrawlResult[];
  activeCrawl: CrawlResult | null;
  loading: boolean;
  error: string | null;
}
