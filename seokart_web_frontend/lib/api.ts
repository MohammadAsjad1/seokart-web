import axiosInstance from "./axios";
import {
  AuthResponse,
  LoginCredentials,
  SignupCredentials,
  User,
} from "@/types/auth";

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    try {
      const response = await axiosInstance.post("/auth/login", credentials);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  googleAuth: async (data: { credential: string }) => {
    const response = await axiosInstance.post("/auth/google", data);
    return response.data;
  },

  signup: async (credentials: SignupCredentials): Promise<AuthResponse> => {
    try {
      const response = await axiosInstance.post("/auth/signup", credentials);
      return response.data;
    } catch (error) {
      throw error;
    }
  },
  completeSetup: async (data: { plan: string; domain: string }) => {
    const response = await axiosInstance.post('/auth/complete-setup', data);
    return response.data;
  },

  getProfile: async (): Promise<User> => {
    const { data } = await axiosInstance.get("/auth/profile");
    return data;
  },

  logout: async (): Promise<void> => {
    try {
      await axiosInstance.post("/auth/logout");
    } catch (error) {
      console.error("Logout error:", error);
    }
  },

  loadUser: async (signedPayload: string): Promise<any> => {
    try {
      const response = await axiosInstance.get(`/load?signed_payload_jwt=${signedPayload}`);
      return response.data;
    } catch (error: any) {
      throw error;
    }
  },
};
