// lib/api/userPlan.ts
import { 
  UserPlan, 
  PlanInfo, 
  UpdatePlanRequest, 
  UsageUpdateRequest, 
  LimitsCheckResponse,
  CreatePlanWithDomainRequest,
  DomainOperationResponse
} from '@/types/userPlan';
import axiosInstance from '@/lib/axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

class UserPlanAPI {
  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const config = {
      ...options,
      timeout: 10000,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const url = `${API_BASE_URL}/user-plan${endpoint}`;
    
    const response = await fetch(url, config);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  }

  // Get plan information and pricing (public)
  async getPlanInfo(): Promise<PlanInfo> {
    const { data } = await axiosInstance.get('/user-plan/info');
    return data.data;
  }

  // Create initial user plan (basic)
  async createUserPlan(domain?: string): Promise<UserPlan> {
    const payload = domain ? { domain } : {};
    const response = await axiosInstance.post('/user-plan/', payload);
    return response.data.data;
  }

  // Create user plan with domain (new method)
  async createUserPlanWithDomain(requestData: CreatePlanWithDomainRequest): Promise<UserPlan> {
    const response = await axiosInstance.post('/user-plan/with-domain', requestData);
    return response.data.data;
  }

  // Get user plan details
  async getUserPlan(): Promise<UserPlan> {
    const { data } = await axiosInstance.get('/user-plan');
    return data.data;
  }

  // Update user plan (upgrade/downgrade)
  async updateUserPlan(
    userId: string,
    updateData: UpdatePlanRequest
  ): Promise<{
    userId: string;
    service: string;
    previousPlan: string;
    currentPlan: string;
    limits: any;
    features: unknown;
    subscription: unknown;
  }> {
    try {
      const response = await axiosInstance.put('/user-plan', updateData);
      return response.data.data;
    } catch (error: any) {
      console.error('Failed to update user plan:', error?.response?.data || error.message);
      throw error;
    }
  }

  // Domain management methods
  async addDomain(domain: string, setAsActive: boolean = false): Promise<DomainOperationResponse> {
    const response = await axiosInstance.post('/user-plan/domains', {
      domain,
      setAsActive
    });
    return response.data.data;
  }

  async setActiveDomain(domain: string): Promise<DomainOperationResponse> {
    const response = await axiosInstance.put('/user-plan/domains/active', {
      domain
    });
    return response.data.data;
  }

  async removeDomain(domain: string): Promise<DomainOperationResponse> {
    const response = await axiosInstance.delete(`/user-plan/domains/${encodeURIComponent(domain)}`);
    return response.data.data;
  }

  async getUserDomains(): Promise<DomainOperationResponse> {
    const response = await axiosInstance.get('/user-plan/domains');
    return response.data.data;
  }

  // Update usage counters
  async updateUsage(userId: string, usageData: UsageUpdateRequest): Promise<{
    service: string;
    resource: string;
    usage: unknown;
    limits: unknown;
  }> {
    const response = await this.makeRequest('/usage', {
      method: 'POST',
      body: JSON.stringify(usageData),
    });
    return response.data;
  }

  // Check if user can perform specific actions
  async checkLimits(userId: string, service?: string, resource?: string): Promise<LimitsCheckResponse> {
    const queryParams = new URLSearchParams();
    if (service) queryParams.append('service', service);
    if (resource) queryParams.append('resource', resource);
    
    const endpoint = `/limits${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await axiosInstance.get(`/user-plan${endpoint}`);
    return response.data.data;
  }

  // Get admin statistics
  async getAdminStats(): Promise<{
    planDistribution: unknown[];
    subscriptionStatus: unknown[];
    totalUsers: number;
  }> {
    const response = await this.makeRequest('/admin/stats');
    return response.data;
  }
}

export const userPlanApi = new UserPlanAPI();