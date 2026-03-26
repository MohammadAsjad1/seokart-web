"use client";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface Channel {
  store_hash: string;
  channel_id: string;
  name: string;
  storefront_url: string;
}

interface ChannelState {
  channels: Channel[];
  selectedChannel: Channel | null;
  loading: boolean;
  error: string | null;
}

const initialState: ChannelState = {
  channels: localStorage.getItem("channels")
    ? JSON.parse(localStorage.getItem("channels") as string)
    : [],
  selectedChannel: localStorage.getItem("selectedChannel")
    ? JSON.parse(localStorage.getItem("selectedChannel") as string)
    : null,
  loading: false,
  error: null,
};

const channelSlice = createSlice({
  name: "channel",
  initialState,
  reducers: {
    setChannels: (state, action: PayloadAction<Channel[]>) => {
      state.channels = action.payload;
      localStorage.setItem("channels", JSON.stringify(action.payload));
    },
    setSelectedChannel: (state, action: PayloadAction<Channel>) => {
      state.selectedChannel = action.payload;
      localStorage.setItem("selectedChannel", JSON.stringify(action.payload));
    },
    clearSelectedChannel: (state) => {
      state.selectedChannel = null;
    },
  },
});

export const { setChannels, setSelectedChannel, clearSelectedChannel } =
  channelSlice.actions;
export default channelSlice.reducer;
