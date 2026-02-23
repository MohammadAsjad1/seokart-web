'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { checkAuth, resetAuth } from '@/store/slices/authSlice';

const SETUP_ROUTE = '/select-plan';
const SESSION_EXPIRES_AT_KEY = 'sessionExpiresAt';
const LOAD_ROUTE = '/load';

function isSessionExpired(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const expiresAt = localStorage.getItem(SESSION_EXPIRES_AT_KEY);
    if (!expiresAt) return false;
    const expiresAtMs = new Date(expiresAt).getTime();
    if (Number.isNaN(expiresAtMs)) return false;
    return Date.now() >= expiresAtMs;
  } catch {
    return false;
  }
}

/**
 * With BigCommerce, users are identified via the app load (signed_payload/session).
 * No separate login page – only route between setup (select-plan) and dashboard when we have a user.
 */
export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, hasCheckedAuth } = useAppSelector((state) => state.auth);

  const clearExpiredSession = useCallback((): boolean => {
    if (!isSessionExpired()) return false;
    try {
      localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
    } catch {
      // ignore storage errors
    }
    dispatch(resetAuth());
    router.replace(LOAD_ROUTE);
    return true;
  }, [dispatch, router]);

  useEffect(() => {
    clearExpiredSession();
  }, [clearExpiredSession]);

  useEffect(() => {
    if (!hasCheckedAuth) {
      dispatch(checkAuth());
    }
  }, [hasCheckedAuth, dispatch]);

  useEffect(() => {
    if (!loading && hasCheckedAuth && user) {
      if (clearExpiredSession()) return;
      const isSetupRoute = pathname === SETUP_ROUTE;

      if (user.needsSetup && !isSetupRoute) {
        router.replace(SETUP_ROUTE);
      } else if (!user.needsSetup && isSetupRoute) {
        router.replace('/dashboard');
      }
    }
  }, [loading, hasCheckedAuth, user, pathname, router, clearExpiredSession]);

  return <>{children}</>;
}