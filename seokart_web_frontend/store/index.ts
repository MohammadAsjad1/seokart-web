import '@/lib/storage-polyfill';
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import backlinkReducer from "./slices/backlinkSlice";
import scraperReducer from "./slices/scraperSlice";
import userPlanReducer from "./slices/userPlanSlice";
import rankTrackerReducer from "./slices/rankTrackerSlice";
import socketReducer from "./slices/socketSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    backlink: backlinkReducer,
    scraper: scraperReducer,
    userPlan: userPlanReducer,
    rankTracker: rankTrackerReducer,
    socket: socketReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          "socket/setSocket",
          "socket/setUserActivities",
          "socket/updateSingleActivity",
          "scraper/updateActivitiesFromSocket",
        ],
        ignoredPaths: ["socket.socket", "socket.lastUpdateTime"],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;