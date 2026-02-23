'use client';

import '@/lib/storage-polyfill';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { usePathname } from 'next/navigation';
import { ReduxProvider } from '@/store/ReduxProvider';
import { AuthInitializer } from '@/components/AuthInitializer';
import { ToastContainer } from '@/components/ToastContainer';
import { PageTransition } from '@/components/PageTransition';

import { AppLayout } from '@/components/AppLayout';

const inter = Inter({ subsets: ['latin'] });

const metadata: Metadata = {
  title: 'Auth App',
  description: 'Next.js Authentication with JWT',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const noLayoutRoutes = ['/select-plan'];
  const shouldShowLayout = !noLayoutRoutes.includes(pathname);

  return (
    <html lang="en">
      <body className={`${inter.className} bg-background`}>
        <ReduxProvider>

              <AuthInitializer>
                      {shouldShowLayout ? (
                        <AppLayout>{children}</AppLayout>
                      ) : (
                        <div className="min-h-screen flex items-center bg-background w-screen relative">
                          {/* <PageTransition fullScreen={true}>{children}</PageTransition> */}
                          {children}
                        </div>
                      )}
                      <ToastContainer />
              </AuthInitializer>

        </ReduxProvider>
      </body>
    </html>
  );
}