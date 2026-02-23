import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { io, Socket } from 'socket.io-client';
import { UserActivity } from './scraperSlice';

interface SocketState {
  socket: Socket | null;
  isConnected: boolean;
  userActivities: UserActivity[];
  lastUpdateTime: Date | null;
  error: string | null;
}

const initialState: SocketState = {
  socket: null,
  isConnected: false,
  userActivities: [],
  lastUpdateTime: null,
  error: null,
};

const socketSlice = createSlice({
  name: 'socket',
  initialState,
  reducers: {
    setSocket: (state, action: PayloadAction<Socket>) => {
      state.socket = action.payload as any;
    },
    setConnected: (state, action: PayloadAction<boolean>) => {
      state.isConnected = action.payload;
    },
    setUserActivities: (state, action: PayloadAction<UserActivity[]>) => {
      state.userActivities = action.payload;
      state.lastUpdateTime = new Date() as any;
    },
    updateSingleActivity: (state, action: PayloadAction<UserActivity>) => {
      const index = state.userActivities.findIndex(
        (activity) => activity._id === action.payload._id
      );
      if (index !== -1) {
        state.userActivities[index] = action.payload;
      } else {
        state.userActivities.unshift(action.payload);
      }
      state.lastUpdateTime = new Date() as any;
    },
    setSocketError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
    },
    clearSocketError: (state) => {
      state.error = null;
    },
    resetSocket: (state) => {
      state.socket = null;
      state.isConnected = false;
      state.userActivities = [];
      state.lastUpdateTime = null;
      state.error = null;
    },
  },
});

export const {
  setSocket,
  setConnected,
  setUserActivities,
  updateSingleActivity,
  setSocketError,
  clearSocketError,
  resetSocket,
} = socketSlice.actions;

export default socketSlice.reducer;