'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Loader } from '@/components/ui/Loader';

interface PageTransitionProps {
  children: React.ReactNode;
  fullScreen?: boolean; // For login/signup pages
}

export const PageTransition = ({ children, fullScreen = false }: PageTransitionProps) => {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if(pathname !== '/load') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsTransitioning(true);
    }
    const timer = setTimeout(() => {
      setIsTransitioning(false);
    }, 1000); // 1 second transition

    return () => clearTimeout(timer);
  }, [pathname]);

  return (
    <>
      {children}
      {isTransitioning && (
        <div className={`${fullScreen ? 'fixed inset-0' : 'absolute inset-0'} bg-white z-40 flex items-center justify-center`}>
          <div className="text-center">
            <Loader />
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
      )}
    </>
  );
};