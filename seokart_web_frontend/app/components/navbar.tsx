'use client';

import Link from 'next/link';
import React from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAppDispatch } from '@/store/hooks';
import { logout } from '@/store/slices/authSlice';
import { showToast } from '@/lib/toast';
import { RefreshCw } from 'lucide-react';

const LoadingSpinner = ({ size = 'w-6 h-6', className = '' }) => (
  <div className={`${className} flex items-center justify-center`}>
    <RefreshCw className={`${size} animate-spin text-gray-400`} />
  </div>
);

export default function Navbar() {
  const pathname = usePathname();
  const dispatch = useAppDispatch();
  const [loading, setLoading] = React.useState(false);

  const handleLogout = async () => {
    try {
      setLoading(true);
      await dispatch(logout()).unwrap();
      showToast('Logged out successfully', 'success');
    } catch (error) {
      showToast('Logout failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const navItems = [
    {
      href: '/dashboard',
      icon: '/images/dashboard-icon.svg',
      label: 'Dashboard',
    },
    {
      href: '/rank-tracker',
      icon: '/images/analytics-icon.svg',
      label: 'Rank Tracker',
    },
    {
      href: '/profile',
      icon: '/images/seo-audit-icon.svg',
      label: 'Technical',
    },
  ];

  if (loading) {
    return <LoadingSpinner size="w-4 h-4" />;
  }

  return (
    <>
      <div className="bg-sidebar sidebar fixed z-10 left-0 overflow-hidden h-full py-6">
        <nav className="custom-navbar">
          <ul>
            <li className="nav-logo mb-4 px-2">
              <Link href="/" className="inline-block w-full">
                <div className="menu-hover-logo flex justify-between">
                  <Image src="/images/logo.svg" alt="" width="155" height="34" />
               
                </div>
              </Link>
            </li>

            {navItems.map((item) => (
              <li key={item.href} className="py-1 px-3">
                <Link href={item.href} className={`flex gap-2 ${pathname === item.href ? 'active' : ''}`}>
                  <Image src={item.icon} alt="" width="20" height="20" />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          {/* <div className="justify-center absolute bottom-10 px-5">
            <button onClick={handleLogout} className="flex gap-2">
              <Image src={'/images/logout-icon.svg'} alt="" width="20" height="20" />
              <span className="text-black text-sm">Logout</span>
            </button>
          </div> */}
        </nav>
      </div>
    </>
  );
}