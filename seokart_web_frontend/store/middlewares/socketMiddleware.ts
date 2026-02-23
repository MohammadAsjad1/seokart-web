import { Middleware } from "@reduxjs/toolkit";
import { io, Socket } from "socket.io-client";
import {
  setSocket,
  setConnected,
  setUserActivities,
  updateSingleActivity,
  setSocketError,
  resetSocket,
} from "../slices/socketSlice";
import { updateActivitiesFromSocket } from "../slices/scraperSlice";

let socket: Socket | null = null;

export const initializeSocket = (): any => {
  return (dispatch: any) => {
    if (socket?.connected) {
      console.log("Socket already connected");
      return;
    }

    const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5000";

    socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      console.log("✅ Socket connected:", socket?.id);
      dispatch(setConnected(true));
      dispatch(setSocket(socket as any));
      dispatch(requestActivities());
    });

    socket.on("disconnect", (reason) => {
      console.log("❌ Socket disconnected:", reason);
      dispatch(setConnected(false));
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      dispatch(setSocketError(error.message));
      dispatch(setConnected(false));
    });

    socket.on("user_activities_update", (response: any) => {
      if (response.success && response.data) {
        dispatch(setUserActivities(response.data));
        dispatch(updateActivitiesFromSocket(response.data));
      }
    });

    socket.on("activity_status_update", (activity: any) => {
      if (activity.success) {
        dispatch(updateSingleActivity(activity));
        dispatch(updateActivitiesFromSocket([activity]));
      }
    });

    socket.on("crawl_started", (data: any) => {
      dispatch(requestActivities());
    });

    socket.on("crawl_progress", (data: any) => {
      if (data.activityId) {
        dispatch(updateSingleActivity(data));
      }
    });

    socket.on("crawl_complete", (data: any) => {
      dispatch(requestActivities());
    });

    socket.on("error", (error: any) => {
      console.error("Socket error event:", error);
      dispatch(setSocketError(error.message || "Socket error occurred"));
    });

    dispatch(setSocket(socket as any));
  };
};

export const disconnectSocket = (): any => {
  return (dispatch: any) => {
    if (socket) {
      socket.disconnect();
      socket = null;
      dispatch(resetSocket());
    }
  };
};

export const requestActivities = (): any => {
  return () => {
    if (socket?.connected) {
      socket.emit("get_user_activities");
    }
  };
};

export const requestActivityStatus = (activityId: string): any => {
  return () => {
    if (socket?.connected) {
      socket.emit("get_activity_status", activityId);
    }
  };
};