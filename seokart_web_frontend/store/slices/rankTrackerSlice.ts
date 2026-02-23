import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import axiosInstance from '@/lib/axios';
import {
  Keyword,
  KeywordSuggestion,
  Competitor,
  CompetitorSuggestion,
  KeywordRanking,
  DashboardSummary,
  HistoricalRanking,
  KeywordInsightsResponse,
  CompetitorInsightsResponse,
  AddKeywordRequest,
  BulkKeywordRequest,
  BulkKeywordResponse,
  AddCompetitorRequest,
  RefreshRankingsRequest,
  RefreshRankingsResponse,
  ApiResponse,
  KeywordsResponse,
  CompetitorsResponse,
  GetKeywordsParams,
  GetKeywordSuggestionsParams,
  GetDashboardRankingsParams,
  GetPreviousRankingsParams,
  KeywordAnalysisData,
  DashboardRankingsResponse,
  PreviousRankingsResponse,
} from '@/types/rankTracker';

interface RankTrackerState {
  keywords: Keyword[];
  keywordSuggestions: KeywordSuggestion[];
  competitors: Competitor[];
  competitorSuggestions: CompetitorSuggestion[];
  dashboardRankings: KeywordRanking[];
  dashboardSummary: DashboardSummary | null;
  historicalRankings: HistoricalRanking[];
  keywordInsights: KeywordInsightsResponse | null;
  competitorInsights: CompetitorInsightsResponse | null;
  keywordAnalysis: KeywordAnalysisData | null;
  loading: boolean;
  error: string | null;
}

const initialState: RankTrackerState = {
  keywords: [],
  keywordSuggestions: [],
  competitors: [],
  competitorSuggestions: [],
  dashboardRankings: [],
  dashboardSummary: null,
  historicalRankings: [],
  keywordInsights: null,
  competitorInsights: null,
  keywordAnalysis: null,
  loading: false,
  error: null,
};

export const addKeyword = createAsyncThunk(
  'rankTracker/addKeyword',
  async (request: AddKeywordRequest, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/rank-tracker/add-keyword', request);
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to add keyword');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to add keyword');
    }
  }
);

export const bulkAddKeywords = createAsyncThunk(
  'rankTracker/bulkAddKeywords',
  async (request: BulkKeywordRequest, { rejectWithValue, dispatch }) => {
    try {
      const response = await axiosInstance.post('/rank-tracker/bulk-add-keywords', request);
      if (response.data.success) {
        await dispatch(getKeywords({ page: undefined, limit: undefined, search: undefined }));
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to bulk add keywords');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to bulk add keywords');
    }
  }
);

export const removeKeyword = createAsyncThunk(
  'rankTracker/removeKeyword',
  async (keywordId: string, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.delete(`/rank-tracker/remove-keyword/${keywordId}`);
      if (response.data.success) {
        return keywordId;
      }
      throw new Error(response.data.message || 'Failed to remove keyword');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to remove keyword');
    }
  }
);

export const bulkRemoveKeywords = createAsyncThunk(
  'rankTracker/bulkRemoveKeywords',
  async (keywordIds: string[], { rejectWithValue }) => {
    try {
      if (!keywordIds.length) {
        throw new Error('No keyword IDs provided');
      }

      const response = await axiosInstance.delete('/rank-tracker/bulk-remove-keywords', {
        data: { keywordIds },
      });

      if (response.data.success) {
        return { keywordIds, result: response.data.data };
      }
      throw new Error(response.data.message || 'Failed to bulk remove keywords');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to bulk remove keywords');
    }
  }
);

export const getKeywords = createAsyncThunk(
  'rankTracker/getKeywords',
  async (params: GetKeywordsParams = { page: undefined, limit: undefined, search: undefined }, { rejectWithValue }) => {
    try {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.limit) queryParams.append('limit', params.limit.toString());
      if (params.search) queryParams.append('search', params.search);

      const response = await axiosInstance.get(`/rank-tracker/keywords?${queryParams}`);
      if (response.data.success) {
        return response.data.data.keywords;
      }
      throw new Error(response.data.message || 'Failed to fetch keywords');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to fetch keywords');
    }
  }
);

export const getKeywordSuggestions = createAsyncThunk(
  'rankTracker/getKeywordSuggestions',
  async ({ targetDomain, limit = 10 }: GetKeywordSuggestionsParams, { rejectWithValue }) => {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('targetDomain', targetDomain);
      if (limit) queryParams.append('limit', limit.toString());

      const response = await axiosInstance.get(`/rank-tracker/keyword-suggestions?${queryParams}`);
      if (response.data.success) {
        return response.data.data.suggestions;
      }
      throw new Error(response.data.message || 'Failed to fetch keyword suggestions');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to fetch keyword suggestions');
    }
  }
);

export const syncCompetitors = createAsyncThunk(
  'rankTracker/syncCompetitors',
  async (competitors: AddCompetitorRequest, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/rank-tracker/add-competitor', {
        competitors: competitors,
      });
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to sync competitors');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to sync competitors');
    }
  }
);

export const addCompetitor = createAsyncThunk(
  'rankTracker/addCompetitor',
  async (request: AddCompetitorRequest, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/rank-tracker/add-competitor', {
        competitors: request,
      });
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to add competitor');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to add competitor');
    }
  }
);

export const removeCompetitor = createAsyncThunk(
  'rankTracker/removeCompetitor',
  async (competitorId: string, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.delete(`/rank-tracker/remove-competitor/${competitorId}`);
      if (response.data.success) {
        return competitorId;
      }
      throw new Error(response.data.message || 'Failed to remove competitor');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to remove competitor');
    }
  }
);

export const getCompetitors = createAsyncThunk(
  'rankTracker/getCompetitors',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get('/rank-tracker/competitors');
      if (response.data.success) {
        return response.data.data.competitors;
      }
      throw new Error(response.data.message || 'Failed to fetch competitors');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to fetch competitors');
    }
  }
);

export const getCompetitorSuggestions = createAsyncThunk(
  'rankTracker/getCompetitorSuggestions',
  async ({ targetDomain, limit = 10 }: GetKeywordSuggestionsParams, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get('/rank-tracker/competitor-suggestions', {
        params: { targetDomain, limit },
      });
      if (response.data.success) {
        return response.data.data.suggestions;
      }
      throw new Error(response.data.message || 'Failed to fetch competitor suggestions');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to fetch competitor suggestions');
    }
  }
);

export const getDashboardRankings = createAsyncThunk(
  'rankTracker/getDashboardRankings',
  async (params: GetDashboardRankingsParams, { rejectWithValue }) => {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('targetDomain', params.targetDomain);

      const response = await axiosInstance.get(`/rank-tracker/dashboard-rankings?${queryParams}`);
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to fetch dashboard rankings');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to fetch dashboard rankings');
    }
  }
);

export const getPreviousRankings = createAsyncThunk(
  'rankTracker/getPreviousRankings',
  async (params: GetPreviousRankingsParams, { rejectWithValue }) => {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('domain', params.domain);
      if (params.keywordId) queryParams.append('keywordId', params.keywordId);
      if (params.weeks) queryParams.append('weeks', params.weeks.toString());

      const response = await axiosInstance.get(`/rank-tracker/previous-rankings?${queryParams}`);
      if (response.data.success) {
        return response.data.data.rankings;
      }
      throw new Error(response.data.message || 'Failed to fetch previous rankings');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to fetch previous rankings');
    }
  }
);

export const refreshRankings = createAsyncThunk(
  'rankTracker/refreshRankings',
  async (request: RefreshRankingsRequest = {}, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/rank-tracker/refresh', request);
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to refresh rankings');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to refresh rankings');
    }
  }
);

export const getKeywordAnalysis = createAsyncThunk(
  'rankTracker/getKeywordAnalysis',
  async (keywordId: string, { rejectWithValue }) => {
    try {
      if (!keywordId) {
        throw new Error('Keyword ID is required');
      }

      const response = await axiosInstance.post('/rank-tracker/history', { keywordId });
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to fetch keyword analysis');
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || err.message || 'Failed to fetch keyword analysis');
    }
  }
);

const rankTrackerSlice = createSlice({
  name: 'rankTracker',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    resetState: (state) => {
      return { ...initialState };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(addKeyword.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addKeyword.fulfilled, (state, action) => {
        state.loading = false;
        state.keywords = [action.payload, ...state.keywords];
        state.error = null;
      })
      .addCase(addKeyword.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(bulkAddKeywords.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(bulkAddKeywords.fulfilled, (state) => {
        state.loading = false;
        state.error = null;
      })
      .addCase(bulkAddKeywords.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(removeKeyword.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(removeKeyword.fulfilled, (state, action) => {
        state.loading = false;
        state.keywords = state.keywords.filter((keyword) => keyword._id !== action.payload);
        state.error = null;
      })
      .addCase(removeKeyword.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(bulkRemoveKeywords.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(bulkRemoveKeywords.fulfilled, (state, action) => {
        state.loading = false;
        const { keywordIds } = action.payload;
        state.keywords = state.keywords.filter((keyword) => !keywordIds.includes(keyword._id));
        state.dashboardRankings = state.dashboardRankings.filter(
          (ranking) => !keywordIds.includes(ranking.keywordId)
        );
        state.error = null;
      })
      .addCase(bulkRemoveKeywords.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(getKeywords.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getKeywords.fulfilled, (state, action) => {
        state.loading = false;
        state.keywords = action.payload;
        state.error = null;
      })
      .addCase(getKeywords.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(getKeywordSuggestions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getKeywordSuggestions.fulfilled, (state, action) => {
        state.loading = false;
        state.keywordSuggestions = action.payload;
        state.error = null;
      })
      .addCase(getKeywordSuggestions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(syncCompetitors.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(syncCompetitors.fulfilled, (state, action) => {
        state.loading = false;
        state.error = null;
      })
      .addCase(syncCompetitors.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(addCompetitor.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addCompetitor.fulfilled, (state, action) => {
        state.loading = false;
        state.competitors = [action.payload, ...state.competitors];
        state.error = null;
      })
      .addCase(addCompetitor.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(removeCompetitor.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(removeCompetitor.fulfilled, (state, action) => {
        state.loading = false;
        state.competitors = state.competitors.filter((competitor) => competitor._id !== action.payload);
        state.error = null;
      })
      .addCase(removeCompetitor.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(getCompetitors.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getCompetitors.fulfilled, (state, action) => {
        state.loading = false;
        state.competitors = action.payload;
        state.error = null;
      })
      .addCase(getCompetitors.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(getCompetitorSuggestions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getCompetitorSuggestions.fulfilled, (state, action) => {
        state.loading = false;
        state.competitorSuggestions = action.payload;
        state.error = null;
      })
      .addCase(getCompetitorSuggestions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(getDashboardRankings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getDashboardRankings.fulfilled, (state, action) => {
        state.loading = false;
        state.dashboardRankings = action.payload.keywords;
        state.dashboardSummary = action.payload.summary;
        state.error = null;
      })
      .addCase(getDashboardRankings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(getPreviousRankings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getPreviousRankings.fulfilled, (state, action) => {
        state.loading = false;
        state.historicalRankings = action.payload;
        state.error = null;
      })
      .addCase(getPreviousRankings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(refreshRankings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(refreshRankings.fulfilled, (state) => {
        state.loading = false;
        state.error = null;
      })
      .addCase(refreshRankings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(getKeywordAnalysis.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getKeywordAnalysis.fulfilled, (state, action) => {
        state.loading = false;
        state.keywordAnalysis = action.payload;
        state.error = null;
      })
      .addCase(getKeywordAnalysis.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export const { clearError, resetState } = rankTrackerSlice.actions;

export default rankTrackerSlice.reducer;