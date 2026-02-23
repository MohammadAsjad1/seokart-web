'use client';

import { useAppSelector } from '@/store/hooks';
import { usePathname } from 'next/navigation';
import Navbar from '../app/components/navbar';
import { PageTransition } from '@/components/PageTransition';

const HIDDEN_NAVBAR_ROUTES = ['/login', '/signup', '/forgot-password', "/load"];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAppSelector((state) => state.auth);
  const pathname = usePathname();
  
  const showNavbar = !loading && user && !HIDDEN_NAVBAR_ROUTES.includes(pathname);

  return (
    <div className={showNavbar ? "frame-area activeNav" : ""}>
      {showNavbar && <Navbar />}
      <div className="relative min-h-screen">
        <PageTransition fullScreen={false}>{children}</PageTransition>
      </div>
    </div>
  );
}