'use client';

import { useAppSelector } from '@/store/hooks';
import { Loader } from '@/components/ui/Loader';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { loading } = useAppSelector((state) => state.auth);

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  return <>{children}</>;
}