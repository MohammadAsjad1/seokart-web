import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import axiosInstance from "@/lib/axios";

export interface UserActivity {
  _id: string;
  userId: string;
  websiteUrl: string;
  isSitemapCrawling: number;
  isWebpageCrawling: number;
  startTime: string;
  endTime?: string;
  status: string;
  sitemapCount: number;
  webpageCount: number;
  progress: number;
  errors?: string[];
  webpagesSuccessful?: number;
  isBacklinkFetching?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Webpage {
  _id: string;
  pageUrl: string;
  title: string;
  websiteUrl: string;
  seoScore: number;
  updatedAt: string;
  crawledAt: string;
  isProcessed: boolean;
  hasErrors?: boolean; // added this field to check if the webpage has errors
  statusCode?: number;
  lastCrawled?: string;
  titleLength?: number;
  metaDescriptionLength?: number;
  titleTagIssues?: {
    multiple: boolean;
    duplicate: boolean;
  };
  metaDescriptionIssues?: {
    duplicate: boolean;
    [key: string]: any;
  };
  contentIssues?: {
    lowKeywordDensity: boolean;
    poorReadability: boolean;
    tooShort: boolean;
    [key: string]: any;
  };
  contentQuality?: {
    spellingErrors: string[];
  };
  images?: {
    altTextMissing: string[];
  };
  links?: {
    brokenLinks: string[];
    httpLinks: string[];
    redirectLinks: string[];
  };
  urlIssues?: {
    [key: string]: any;
  };
  content?: any;
  technical?: any;
  analysis?: any;
  scores?: any;
}

export interface PaginationInfo {
  total: number;
  pages: number;
  page: number;
  limit: number;
}

interface ScraperState {
  activities: UserActivity[];
  currentActivity: UserActivity | null;
  loading: boolean;
  error: string | null;
  crawlInProgress: boolean;
  webpages: Webpage[];
  webpageLoading: boolean;
  webpageError: string | null;
  pagination: PaginationInfo | null;
  singleScrapeLoading: { [webpageId: string]: boolean };
  singleScrapeError: string | null;
  deleteLoading: { [activityId: string]: boolean };
  deleteError: string | null;
}

const initialState: ScraperState = {
  activities: [],
  currentActivity: null,
  loading: false,
  error: null,
  crawlInProgress: false,
  webpages: [],
  webpageLoading: false,
  webpageError: null,
  pagination: null,
  singleScrapeLoading: {},
  singleScrapeError: null,
  deleteLoading: {},
  deleteError: null,
};

export const startSitemapCrawl = createAsyncThunk(
  "scraper/startSitemapCrawl",
  async (
    data: { websiteUrl: string; concurrency?: number },
    { rejectWithValue }
  ) => {
    try {
      // const response = await axiosInstance.post("/scraper/scrape", data);
      const response = await axiosInstance.post("/scraper/sitemap-crawl-v2", data);

      const newActivity: UserActivity = {
        _id: response.data.activityId,
        status: response.data.status,
        websiteUrl: response.data.websiteUrl || data.websiteUrl,
        userId: "",
        isSitemapCrawling: 1,
        isWebpageCrawling: 1,
        startTime: new Date().toISOString(),
        sitemapCount: response.data.sitemapCount || 0,
        webpageCount: 0,
        progress: 0,
      };

      return { data: response.data, newActivity };
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to start crawl"
      );
    }
  }
);

export const checkCrawlStatus = createAsyncThunk(
  "scraper/checkCrawlStatus",
  async (activityId: string, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get(`/scraper/status/${activityId}`);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to check crawl status"
      );
    }
  }
);

export const getUserActivities = createAsyncThunk(
  "scraper/getUserActivities",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get("/scraper/get-activities");
      const activities = response.data.data || [];
      return activities;
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to fetch user activities";
      if (errorMessage.toLowerCase().includes("no activities found")) {
        return [];
      }
      return rejectWithValue(errorMessage);
    }
  }
);

export const fetchWebpages = createAsyncThunk(
  "scraper/fetchWebpages",
  async (
    params: {
      activityId: string;
      page?: number;
      limit?: number;
      sort?: string;
      order?: "asc" | "desc";
      filter?: string;
      search?: string;
    },
    { rejectWithValue }
  ) => {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append("page", (params.page || 1).toString());
      queryParams.append("limit", (params.limit || 10).toString());

      if (params.sort) queryParams.append("sort", params.sort);
      if (params.order) queryParams.append("order", params.order);
      if (params.filter) queryParams.append("filter", params.filter);
      if (params.search) queryParams.append("search", params.search);

      const response = await axiosInstance.get(
        `/webpage/${params.activityId}?${queryParams.toString()}`
      );

      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to fetch webpages"
      );
    }
  }
);

export const scrapeWebpage = createAsyncThunk(
  "scraper/scrapeWebpage",
  async (
    data: {
      websiteUrl: string;
      pageUrl: string;
      webpageId: string;
    },
    { rejectWithValue, getState }
  ) => {
    try {
      const response = await axiosInstance.post("/scraper/scrape-url", {
        websiteUrl: data.websiteUrl,
        pageUrl: data.pageUrl,
      });

      return {
        webpageId: data.webpageId,
        data: response.data.data,
      };
    } catch (error: any) {
      return rejectWithValue({
        webpageId: data.webpageId,
        error:
          error.response?.data?.message ||
          error.message ||
          "Failed to scrape webpage",
      });
    }
  }
);

export const deleteActivity = createAsyncThunk(
  "scraper/deleteActivity",
  async (activityId: string, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.delete(
        `/webpage/activity/${activityId}`
      );
      return { activityId, data: response.data };
    } catch (error: any) {
      return rejectWithValue({
        activityId,
        error:
          error.response?.data?.message ||
          error.message ||
          "Failed to delete activity",
      });
    }
  }
);

export const stopSitemapCrawl = createAsyncThunk(
  "scraper/stopSitemapCrawl",
  async (activityId: string, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post("/scraper/stop", {
        activityId,
      });
      return { activityId, data: response.data };
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || error.message || "Failed to stop crawl"
      );
    }
  }
);

const scraperSlice = createSlice({
  name: "scraper",
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearWebpageError: (state) => {
      state.webpageError = null;
    },
    clearSingleScrapeError: (state) => {
      state.singleScrapeError = null;
    },
    clearDeleteError: (state) => {
      state.deleteError = null;
    },
    resetCurrentActivity: (state) => {
      state.currentActivity = null;
      state.crawlInProgress = false;
    },
    updateWebpage: (state, action: PayloadAction<Webpage>) => {
      state.webpages = state.webpages.map((webpage) =>
        webpage._id === action.payload._id ? action.payload : webpage
      );
    },
    setCrawlInProgress: (state, action: PayloadAction<boolean>) => {
      state.crawlInProgress = action.payload;
    },
    updateActivitiesFromSocket: (
      state,
      action: PayloadAction<UserActivity[]>
    ) => {
      state.activities = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(startSitemapCrawl.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(startSitemapCrawl.fulfilled, (state, action) => {
        state.loading = false;
        state.crawlInProgress = true;
        state.currentActivity = action.payload.newActivity;
        state.error = null;
      })
      .addCase(startSitemapCrawl.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(checkCrawlStatus.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(checkCrawlStatus.fulfilled, (state, action) => {
        state.loading = false;
        if (
          state.currentActivity &&
          state.currentActivity._id === action.payload._id
        ) {
          state.currentActivity = action.payload;
        }
        if (
          action.payload.status === "completed" ||
          action.payload.status === "failed"
        ) {
          state.crawlInProgress = false;
        }
      })
      .addCase(checkCrawlStatus.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(getUserActivities.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getUserActivities.fulfilled, (state, action) => {
        state.loading = false;
        state.activities = action.payload;

        if (action.payload.length === 0) {
          state.error = "User activity is empty";
        } else {
          const inProgressActivity = action.payload.find(
            (activity: UserActivity) => activity.status === "processing"
          );

          if (inProgressActivity) {
            state.currentActivity = inProgressActivity;
            state.crawlInProgress = true;
          }
        }
      })
      .addCase(getUserActivities.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(fetchWebpages.pending, (state) => {
        state.webpageLoading = true;
        state.webpageError = null;
      })
      .addCase(fetchWebpages.fulfilled, (state, action) => {
        state.webpageLoading = false;
        state.webpages = action.payload?.data?.webpages || [];
        state.pagination = action.payload?.data?.pagination || null;
      })
      .addCase(fetchWebpages.rejected, (state, action) => {
        state.webpageLoading = false;
        state.webpageError = action.payload as string;
      })
      .addCase(scrapeWebpage.pending, (state, action) => {
        const webpageId = action.meta.arg.webpageId;
        state.singleScrapeLoading[webpageId] = true;
        state.singleScrapeError = null;

        const webpageIndex = state.webpages.findIndex(
          (wp) => wp._id === webpageId
        );
        if (webpageIndex !== -1) {
          state.webpages[webpageIndex].isProcessed = false;
        }
      })
      .addCase(scrapeWebpage.fulfilled, (state, action) => {
        const { webpageId, data } = action.payload;
        state.singleScrapeLoading[webpageId] = false;

        const webpageIndex = state.webpages.findIndex(
          (wp) => wp._id === webpageId
        );
        if (webpageIndex !== -1) {
          state.webpages[webpageIndex] = {
            ...state.webpages[webpageIndex],
            isProcessed: true,
            seoScore: data.seoScore,
            lastCrawled: data.lastCrawled,
          };
        }
      })
      .addCase(scrapeWebpage.rejected, (state, action: any) => {
        const { webpageId, error } = action.payload;
        state.singleScrapeLoading[webpageId] = false;
        state.singleScrapeError = error;

        const webpageIndex = state.webpages.findIndex(
          (wp) => wp._id === webpageId
        );
        if (webpageIndex !== -1) {
          state.webpages[webpageIndex].isProcessed = true;
        }
      })
      .addCase(deleteActivity.pending, (state, action) => {
        const activityId = action.meta.arg;
        state.deleteLoading[activityId] = true;
        state.deleteError = null;
      })
      .addCase(deleteActivity.fulfilled, (state, action) => {
        const { activityId } = action.payload;
        state.deleteLoading[activityId] = false;
        state.activities = state.activities.filter(
          (activity) => activity._id !== activityId
        );
      })
      .addCase(deleteActivity.rejected, (state, action: any) => {
        const { activityId, error } = action.payload;
        state.deleteLoading[activityId] = false;
        state.deleteError = error;
      })
      .addCase(stopSitemapCrawl.pending, (state, action) => {
        const activityId = action.meta.arg;
        state.activities = state.activities.map((activity) =>
          activity._id === activityId
            ? { ...activity, status: "stopping" }
            : activity
        );
      })
      .addCase(stopSitemapCrawl.fulfilled, (state, action) => {
        const { activityId } = action.payload;
        state.activities = state.activities.map((activity) =>
          activity._id === activityId
            ? {
                ...activity,
                status: "stopped",
                isSitemapCrawling: 0,
                isWebpageCrawling: 0,
              }
            : activity
        );
      })
      .addCase(stopSitemapCrawl.rejected, (state, action) => {
        state.error = action.payload as string;
      });
  },
});

export const {
  clearError,
  clearWebpageError,
  clearSingleScrapeError,
  clearDeleteError,
  resetCurrentActivity,
  updateWebpage,
  setCrawlInProgress,
  updateActivitiesFromSocket,
} = scraperSlice.actions;

export default scraperSlice.reducer;
