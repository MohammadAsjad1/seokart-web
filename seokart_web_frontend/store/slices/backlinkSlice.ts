import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import axiosInstance from "@/lib/axios";

export interface BacklinkData {
  url_from: string;
  url_to: string;
  title: string;
  anchor: string;
  alt: string;
  nofollow: boolean;
  image: boolean;
  image_source: string;
  inlink_rank: number;
  domain_inlink_rank: number;
  first_seen: string;
  last_visited: string;
}

export interface BacklinkSummary {
  _id: string;
  userId: string;
  websiteUrl: string;
  target: string;
  status: "processing" | "completed" | "failed";
  backlinks: number;
  refdomains: number;
  subnets: number;
  ips: number;
  nofollow_backlinks: number;
  dofollow_backlinks: number;
  inlink_rank: number;
  anchors: number;
  edu_backlinks: number;
  gov_backlinks: number;
  domain_inlink_rank: number;
  from_home_page_backlinks: number;
  dofollow_from_home_page_backlinks: number;
  text_backlinks: number;
  dofollow_refdomains: number;
  from_home_page_refdomains: number;
  edu_refdomains: number;
  gov_refdomains: number;
  dofollow_anchors: number;
  pages_with_backlinks: number;
  backlinks_data: BacklinkData[];
  lastFetched?: string;
  apiResponseTime?: number;
  summaryApiTime?: number;
  backlinksApiTime?: number;
  apiStatus?: "success" | "failed" | "partial";
  errorMessage?: string;
  processingStarted?: string;
  processingCompleted?: string;
  isFresh?: boolean;
  ageInHours?: number;
  processingDuration?: number;
}

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextPage: number | null;
  prevPage: number | null;
}

export interface FilterInfo {
  query: string | null;
  anchorText: string | null;
  firstSeenFromDate: string | null;
  firstSeenToDate: string | null;
  lastSeenFromDate: string | null;
  lastSeenToDate: string | null;
  sortBy: string;
  minDomainScore: number | null;
  maxDomainScore: number | null;
  linkTypes: string[] | null;
}

export interface DashboardResponse {
  documents: BacklinkSummary[];
  pagination: PaginationInfo;
  filters: FilterInfo;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

interface BacklinkState {
  dashboardData: DashboardResponse | null;
  backlinkSummary: BacklinkSummary | null;
  backlinksData: BacklinkData[];
  loading: boolean;
  processing: boolean;
  error: string | null;
  searchTerm: string;
  sortBy: string;
  firstSeenFromDate: string;
  firstSeenToDate: string;
  lastSeenFromDate: string;
  lastSeenToDate: string;
  currentPage: number;
  itemsPerPage: number;
  minDomainScore: number;
  maxDomainScore: number;
  linkTypes: string[];
  anchorText: string;
}

const initialState: BacklinkState = {
  dashboardData: null,
  backlinkSummary: null,
  backlinksData: [],
  loading: false,
  processing: false,
  error: null,
  searchTerm: "",
  sortBy: "inlink_rank",
  firstSeenFromDate: "",
  firstSeenToDate: "",
  lastSeenFromDate: "",
  lastSeenToDate: "",
  currentPage: 1,
  itemsPerPage: 10,
  minDomainScore: 0,
  maxDomainScore: 100,
  linkTypes: [],
  anchorText: "",
};

export const getDashboardData = createAsyncThunk(
  "backlink/getDashboardData",
  async (
    { websiteUrl, options = {} }: { websiteUrl: string; options?: any },
    { rejectWithValue }
  ) => {
    try {
      const params = new URLSearchParams();
      params.append("websiteUrl", websiteUrl);

      if (options.page) params.append("page", options.page.toString());
      if (options.limit) params.append("limit", options.limit.toString());
      if (options.query) params.append("query", options.query);
      if (options.firstSeenFromDate)
        params.append("firstSeenFromDate", options.firstSeenFromDate);
      if (options.firstSeenToDate)
        params.append("firstSeenToDate", options.firstSeenToDate);
      if (options.lastSeenFromDate)
        params.append("lastSeenFromDate", options.lastSeenFromDate);
      if (options.lastSeenToDate)
        params.append("lastSeenToDate", options.lastSeenToDate);
      if (options.sortBy) params.append("sortBy", options.sortBy);
      if (options.minDomainScore !== undefined)
        params.append("minDomainScore", options.minDomainScore.toString());
      if (options.maxDomainScore !== undefined)
        params.append("maxDomainScore", options.maxDomainScore.toString());
      if (options.linkTypes && options.linkTypes.length > 0)
        params.append("linkTypes", options.linkTypes.join(","));
      if (options.anchorText) params.append("anchorText", options.anchorText);

      const response = await axiosInstance.get(
        `/backlinks/dashboard?${params.toString()}`
      );

      if (!response.data.success) {
        throw new Error(
          response.data.message || "Failed to get dashboard data"
        );
      }

      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to get dashboard data"
      );
    }
  }
);

export const checkProcessingStatus = createAsyncThunk(
  "backlink/checkProcessingStatus",
  async (websiteUrl: string, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get(
        `/backlinks/status?websiteUrl=${websiteUrl}`
      );
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to check status"
      );
    }
  }
);

export const refreshBacklinkData = createAsyncThunk(
  "backlink/refreshBacklinkData",
  async (websiteUrl: string, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post("/backlinks/refresh", {
        websiteUrl,
      });
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to refresh data"
      );
    }
  }
);

const backlinkSlice = createSlice({
  name: "backlink",
  initialState,
  reducers: {
    setSearchTerm: (state, action: PayloadAction<string>) => {
      state.searchTerm = action.payload;
    },
    setSortBy: (state, action: PayloadAction<string>) => {
      state.sortBy = action.payload;
    },
    setFirstSeenFromDate: (state, action: PayloadAction<string>) => {
      state.firstSeenFromDate = action.payload;
    },
    setFirstSeenToDate: (state, action: PayloadAction<string>) => {
      state.firstSeenToDate = action.payload;
    },
    setLastSeenFromDate: (state, action: PayloadAction<string>) => {
      state.lastSeenFromDate = action.payload;
    },
    setLastSeenToDate: (state, action: PayloadAction<string>) => {
      state.lastSeenToDate = action.payload;
    },
    setCurrentPage: (state, action: PayloadAction<number>) => {
      state.currentPage = action.payload;
    },
    setItemsPerPage: (state, action: PayloadAction<number>) => {
      state.itemsPerPage = action.payload;
    },
    setMinDomainScore: (state, action: PayloadAction<number>) => {
      state.minDomainScore = action.payload;
    },
    setMaxDomainScore: (state, action: PayloadAction<number>) => {
      state.maxDomainScore = action.payload;
    },
    setLinkTypes: (state, action: PayloadAction<string[]>) => {
      state.linkTypes = action.payload;
    },
    setAnchorText: (state, action: PayloadAction<string>) => {
      state.anchorText = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    resetState: (state) => {
      state.dashboardData = null;
      state.backlinkSummary = null;
      state.backlinksData = [];
      state.loading = false;
      state.processing = false;
      state.error = null;
    },
    setProcessing: (state, action: PayloadAction<boolean>) => {
      state.processing = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getDashboardData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(
        getDashboardData.fulfilled,
        (state, action: PayloadAction<ApiResponse<DashboardResponse>>) => {
          state.loading = false;
          state.dashboardData = action.payload.data;

          if (
            action.payload.data.documents &&
            action.payload.data.documents.length > 0
          ) {
            state.backlinkSummary = action.payload.data.documents[0];
            state.backlinksData =
              action.payload.data.documents[0].backlinks_data || [];
          } else {
            state.backlinkSummary = null;
            state.backlinksData = [];
          }
          state.error = null;
        }
      )
      .addCase(getDashboardData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(checkProcessingStatus.fulfilled, (state, action) => {
        if (action.payload.success && action.payload.data) {
          state.processing = action.payload.data.status === "processing";
        }
      })
      .addCase(checkProcessingStatus.rejected, (state) => {
        state.processing = false;
      })
      .addCase(refreshBacklinkData.pending, (state) => {
        state.processing = true;
        state.error = null;
      })
      .addCase(refreshBacklinkData.fulfilled, (state) => {
        state.error = null;
      })
      .addCase(refreshBacklinkData.rejected, (state, action) => {
        state.processing = false;
        state.error = action.payload as string;
      });
  },
});

export const {
  setSearchTerm,
  setSortBy,
  setFirstSeenFromDate,
  setFirstSeenToDate,
  setLastSeenFromDate,
  setLastSeenToDate,
  setCurrentPage,
  setItemsPerPage,
  setMinDomainScore,
  setMaxDomainScore,
  setLinkTypes,
  setAnchorText,
  clearError,
  resetState,
  setProcessing,
} = backlinkSlice.actions;

export default backlinkSlice.reducer;
