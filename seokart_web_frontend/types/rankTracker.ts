
export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

// ========== KEYWORD TYPES ==========
export interface Keyword {
  _id: string;
  id: string;
  keyword: string;
  targetDomain: string;
  location: string;
  device: string;
  language?: string;
  searchEngine?: string;
  tags: string[];
  currentPosition?: number | null;
  lastUpdated?: string | null;
  createdAt: string;
  updateFrequency?: string;
  isDataFetched?: boolean;
  searchVolume?: number | null;
  difficulty?: number | null;
}

export interface KeywordSuggestion {
  keyword: string;
  searchVolume?: number;
  difficulty?: number;
  competitionLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  competitionIndex?: number;
  source?: string;
}

export interface AddKeywordRequest {
  keyword: string;
  targetDomain: string;
  location?: string;
  device?: string;
  language?: string;
  searchEngine?: string;
  tags?: string[];
}

export interface BulkKeywordRequest {
  keywords: AddKeywordRequest[];
}

export interface BulkKeywordResult {
  keyword: string;
  targetDomain: string;
  success: boolean;
  data?: any;
  error?: string;
}

export interface BulkKeywordResponse {
  successful: number;
  failed: number;
  results: BulkKeywordResult[];
  errors: BulkKeywordResult[];
}

// ========== COMPETITOR TYPES ==========
export interface Competitor {
  _id: string;
  domain: string;
  name: string;
  createdAt: string;
  stats?: {
    averagePosition?: number;
    visibilityScore?: number;
    keywordCount?: number;
    positionDistribution?: {
      top3: number;
      top10: number;
      top20: number;
      top50: number;
      top100: number;
    };
    aiMentions?: {
      googleAiOverview: number;
      googleAiMode: number;
      chatgpt: number;
      totalKeywords: number;
    };
  };
}

export interface CompetitorSuggestion {
  domain: string;
  name: string;
  commonKeywords?: number;
  averagePosition?: number;
  totalKeywords?: number;
  source?: string;
  competitorDomain: string;
}

export interface AddCompetitorRequest {
  domain: string;
  name?: string;
}

// ========== RANKING TYPES ==========
export interface AiTracking {
  chatgpt: boolean;
  aiMode: boolean;
  aiOverview: boolean;
}

export interface RankingData {
  domain: string;
  name?: string;
  currentPosition: number | null;
  previousPosition?: number | null;
  trend: 'up' | 'down' | 'same' | 'new' | 'lost';
  url?: string | null;
  title?: string | null;
  aiTracking?: AiTracking | null;
}

export interface KeywordRanking {
  keywordId: string;
  keyword: string;
  location: string;
  device: string;
  searchVolume?: number | null;
  difficulty?: number | null;
  target: RankingData;
  competitors: RankingData[];
  lastUpdated?: string | null;
  isDataFetched?: boolean;
}

export interface DashboardSummary {
  totalKeywords: number;
  rankedKeywords: number;
  averagePosition: number | null;
  improvingKeywords: number;
  decliningKeywords: number;
  topRankings: number;
}

export interface DashboardRankingsResponse {
  targetDomain: string;
  summary: DashboardSummary;
  keywords: KeywordRanking[];
  hasAiAccess: boolean;
  competitorCount: number;
  lastUpdated: string;
}

// ========== HISTORICAL DATA TYPES ==========
export interface HistoricalPoint {
  week: string;
  position: number | null;
  status: string;
  url?: string;
  title?: string;
  trend: 'up' | 'down' | 'same' | 'new';
  aiTracking?: AiTracking | null;
  checkedAt?: string;
}

export interface HistoricalRanking {
  keywordId?: string;
  keyword: string;
  location: string;
  device: string;
  domain: string;
  currentPosition: number | null;
  currentStatus: string;
  isTargetDomain: boolean;
  isCompetitor: boolean;
  history: HistoricalPoint[];
  lastUpdated?: string;
}

export interface HistoricalSummary {
  totalKeywords: number;
  averageCurrentPosition: number | null;
  bestPosition: number;
  worstPosition: number;
  rankedKeywords: number;
  outOfTop100: number;
}

export interface PreviousRankingsResponse {
  domain: string;
  keywordSpecific: boolean;
  plan: string;
  weeksRequested: number;
  maxWeeksAllowed: number;
  summary: HistoricalSummary;
  rankings: HistoricalRanking[];
  hasAiAccess: boolean;
}

// ========== REFRESH TYPES ==========
export interface RefreshRankingsRequest {
  keywordIds?: string[];
}

export interface RefreshRankingsResponse {
  keywordsRequested: number;
  tasksCreated: number;
  estimatedCompletionTime: string;
  nextAllowedRefresh: string | Date;
}

// ========== INSIGHTS TYPES ==========
export interface KeywordTrendInsight {
  _id: string;
  count: number;
  avgPosition: number;
}

export interface KeywordInsightsResponse {
  totalKeywords: number;
  trends: KeywordTrendInsight[];
  generatedAt: string;
}

export interface CompetitorInsight {
  domain: string;
  name: string;
  averagePosition: number;
  visibilityScore: number;
  keywordCount: number;
}

export interface CompetitorInsightsResponse {
  totalCompetitors: number;
  competitors: CompetitorInsight[];
  generatedAt: string;
}

// ========== PAGINATION TYPES ==========
export interface Pagination {
  current: number;
  pages: number;
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface KeywordsResponse {
  keywords: Keyword[];
  pagination: Pagination;
}

export interface CompetitorsResponse {
  competitors: Competitor[];
}

export interface KeywordAnalysisRequest {
  keywordId: string;
}

export interface CompetitorRankingData {
  domain: string;
  name: string;
  currentPosition: number | null;
  lastUpdated: string | null;
  trend: 'up' | 'down' | 'same' | 'new' | 'lost' | 'no_data';
  url: string | null;
  title: string | null;
  rankingHistory: Record<string, number>;
}

export interface ExtremePositions {
  best: number | null;
  worst: number | null;
}

export interface RankingComparison {
  current: {
    position: number | null;
    month: string | null;
    url: string | null;
    title: string | null;
  };
  previous: {
    position: number | null;
    month: string | null;
    url: string | null;
    title: string | null;
  };
  change: number | null;
  trend: 'up' | 'down' | 'same' | 'new' | 'lost' | 'no_data';
}

export interface KeywordAnalysisSummary {
  totalCompetitors: number;
  competitorsWithData: number;
  rankingDataPoints: number;
  lastUpdated: string;
}

export interface KeywordAnalysisData {
  keyword: {
    id: string;
    keyword: string;
    targetDomain: string;
    location: string;
    device: string;
    language: string;
    searchEngine: string;
  };
  activeDomain: string;
  competitors: CompetitorRankingData[];
  myRankingHistory: Record<string, number>; // { '19-Jul-2025': 77 }
  extremePositions: ExtremePositions;
  comparison: RankingComparison;
  summary: KeywordAnalysisSummary;
}

export interface KeywordAnalysisResponse {
  success: boolean;
  data: KeywordAnalysisData;
  message?: string;
}

// ========== CONTEXT TYPES ==========
export interface RankTrackerContextType {
  // State
  keywords: Keyword[];
  keywordSuggestions: KeywordSuggestion[];
  competitors: Competitor[];
  competitorSuggestions: CompetitorSuggestion[];
  dashboardRankings: KeywordRanking[];
  dashboardSummary: DashboardSummary | null;
  historicalRankings: HistoricalRanking[];
  keywordInsights: KeywordInsightsResponse | null;
  competitorInsights: CompetitorInsightsResponse | null;
  loading: boolean;
  error: string | null;
  keywordAnalysis: KeywordAnalysisData | null;


  // Keyword Methods
  addKeyword: (request: AddKeywordRequest) => Promise<void>;
  bulkAddKeywords: (request: BulkKeywordRequest) => Promise<BulkKeywordResponse>;
  removeKeyword: (keywordId: string) => Promise<void>;
  getKeywords: (page?: number, limit?: number, search?: string) => Promise<void>;
  getKeywordSuggestions: (targetDomain: string, limit?: number) => Promise<void>;

  // Competitor Methods
  addCompetitor: (request: AddCompetitorRequest) => Promise<void>;
  removeCompetitor: (competitorId: string) => Promise<void>;
  getCompetitors: () => Promise<void>;
  getCompetitorSuggestions: (targetDomain: string, limit?: number) => Promise<void>;

  // Rankings Methods
  getDashboardRankings: (targetDomain: string) => Promise<void>;
  getPreviousRankings: (domain: string, keywordId?: string, weeks?: number) => Promise<HistoricalRanking[]>;
  refreshRankings: (keywordIds?: string[]) => Promise<RefreshRankingsResponse>;

  // Insights Methods
  getKeywordInsights: () => Promise<void>;
  getCompetitorInsights: () => Promise<void>;

  getKeywordAnalysis: (keywordId: string) => Promise<KeywordAnalysisData>;

  // Utility Methods
  clearError: () => void;
  resetState: () => void;
  
}

// ========== QUERY PARAMS TYPES ==========
export interface GetKeywordsParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface GetKeywordSuggestionsParams {
  targetDomain: string;
  limit?: number;
}

export interface GetCompetitorsParams {
  page?: number;
  limit?: number;
}

export interface GetCompetitorSuggestionsParams {
  targetDomain: string;
  limit?: number;
}

export interface GetDashboardRankingsParams {
  targetDomain: string;
}

export interface GetPreviousRankingsParams {
  domain: string;
  keywordId?: string;
  weeks?: number;
}