export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  profilePicture?: string;
  provider?: string;
  isVerified?: boolean;
  lastLogin?: Date;
  // New fields for setup flow
  hasCompletedSetup: boolean;
  needsSetup: boolean;
  selectedPlan?: string;
  primaryDomain?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupCredentials extends LoginCredentials {
  username: string;
}
