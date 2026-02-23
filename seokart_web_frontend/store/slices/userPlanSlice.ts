import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { UserPlan, PlanInfo, UpdatePlanRequest, LimitsCheckResponse, CreatePlanWithDomainRequest } from '@/types/userPlan';
import { userPlanApi } from '@/lib/userPlan';

interface UserPlanState {
  userPlan: UserPlan | null;
  planInfo: PlanInfo | null;
  loading: boolean;
  error: string | null;
}

const initialState: UserPlanState = {
  userPlan: null,
  planInfo: null,
  loading: true,
  error: null,
};

export const loadPlanInfo = createAsyncThunk(
  'userPlan/loadPlanInfo',
  async (_, { rejectWithValue }) => {
    try {
      const info = await userPlanApi.getPlanInfo();
      return info;
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to load plan information');
    }
  }
);

export const createUserPlan = createAsyncThunk(
  'userPlan/createUserPlan',
  async (domain: string | undefined, { rejectWithValue, getState }) => {
    try {
      const newPlan = await userPlanApi.createUserPlan(domain);
      return newPlan;
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to create user plan');
    }
  }
);

export const createUserPlanWithDomain = createAsyncThunk(
  'userPlan/createUserPlanWithDomain',
  async ({ domain, setAsActive = true }: { domain: string; setAsActive?: boolean }, { rejectWithValue }) => {
    try {
      const requestData: CreatePlanWithDomainRequest = { domain, setAsActive };
      const newPlan = await userPlanApi.createUserPlanWithDomain(requestData);
      return newPlan;
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to create user plan with domain');
    }
  }
);

export const refreshUserPlan = createAsyncThunk(
  'userPlan/refreshUserPlan',
  async (_, { rejectWithValue, dispatch }) => {
    try {
      const plan = await userPlanApi.getUserPlan();
      return plan;
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        try {
          await dispatch(createUserPlan(undefined)).unwrap();
          return null;
        } catch (createErr) {
          return rejectWithValue('Failed to create user plan');
        }
      }
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to load user plan');
    }
  }
);

export const updatePlan = createAsyncThunk(
  'userPlan/updatePlan',
  async ({ userId, updateData }: { userId: string; updateData: UpdatePlanRequest }, { rejectWithValue }) => {
    try {
      const updatedData = await userPlanApi.updateUserPlan(userId, updateData);
      return { updateData, updatedData };
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to update plan');
    }
  }
);

export const addDomain = createAsyncThunk(
  'userPlan/addDomain',
  async ({ domain, setAsActive = false }: { domain: string; setAsActive?: boolean }, { rejectWithValue }) => {
    try {
      const result = await userPlanApi.addDomain(domain, setAsActive);
      return result;
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to add domain');
    }
  }
);

export const setActiveDomain = createAsyncThunk(
  'userPlan/setActiveDomain',
  async (domain: string, { rejectWithValue }) => {
    try {
      const result = await userPlanApi.setActiveDomain(domain);
      return result;
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to set active domain');
    }
  }
);

export const removeDomain = createAsyncThunk(
  'userPlan/removeDomain',
  async (domain: string, { rejectWithValue }) => {
    try {
      const result = await userPlanApi.removeDomain(domain);
      return result;
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to remove domain');
    }
  }
);

export const checkLimits = createAsyncThunk(
  'userPlan/checkLimits',
  async ({ userId, service, resource }: { userId: string; service: string; resource?: string }, { rejectWithValue }) => {
    try {
      return await userPlanApi.checkLimits(userId, service, resource);
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to check limits');
    }
  }
);

const userPlanSlice = createSlice({
  name: 'userPlan',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    resetUserPlan: (state) => {
      state.userPlan = null;
      state.loading = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadPlanInfo.fulfilled, (state, action) => {
        state.planInfo = action.payload;
      })
      .addCase(loadPlanInfo.rejected, (state, action) => {
        state.error = action.payload as string;
      })
      .addCase(createUserPlan.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createUserPlan.fulfilled, (state, action) => {
        state.loading = false;
        state.userPlan = action.payload;
        state.error = null;
      })
      .addCase(createUserPlan.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(createUserPlanWithDomain.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createUserPlanWithDomain.fulfilled, (state, action) => {
        state.loading = false;
        state.userPlan = action.payload;
        state.error = null;
      })
      .addCase(createUserPlanWithDomain.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(refreshUserPlan.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(refreshUserPlan.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload) {
          state.userPlan = action.payload;
        }
        state.error = null;
      })
      .addCase(refreshUserPlan.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(updatePlan.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updatePlan.fulfilled, (state, action) => {
        state.loading = false;
        if (state.userPlan) {
          const { updateData, updatedData } = action.payload;
          if (updateData.service === 'rankTracker') {
            state.userPlan.rankTracker.plan = updateData.plan as any;
            state.userPlan.features = updatedData.features as any;
          } else {
            state.userPlan.webCrawler.plan = updateData.plan as any;
          }
          state.userPlan.subscription = updatedData.subscription as any;
        }
        state.error = null;
      })
      .addCase(updatePlan.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(addDomain.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addDomain.fulfilled, (state, action) => {
        state.loading = false;
        if (state.userPlan) {
          state.userPlan.domains = action.payload.domains;
          state.userPlan.activeDomain = action.payload.activeDomain?.domain;
          state.userPlan.activeDomainDetails = action.payload.activeDomain;
        }
        state.error = null;
      })
      .addCase(addDomain.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(setActiveDomain.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(setActiveDomain.fulfilled, (state, action) => {
        state.loading = false;
        if (state.userPlan) {
          state.userPlan.activeDomain = action.payload.activeDomain?.domain;
          state.userPlan.activeDomainDetails = action.payload.activeDomain;
          state.userPlan.allDomains = action.payload.allDomains;
        }
        state.error = null;
      })
      .addCase(setActiveDomain.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(removeDomain.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(removeDomain.fulfilled, (state, action) => {
        state.loading = false;
        if (state.userPlan) {
          state.userPlan.domains = action.payload.domains;
          state.userPlan.activeDomain = action.payload.activeDomain?.domain;
          state.userPlan.activeDomainDetails = action.payload.activeDomain;
        }
        state.error = null;
      })
      .addCase(removeDomain.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export const { clearError, resetUserPlan } = userPlanSlice.actions;

export default userPlanSlice.reducer;