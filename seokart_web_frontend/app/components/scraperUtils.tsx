import { Badge } from '@/components/ui/badge';
import Image from 'next/image';

export const getStatusBadge = (statusCode: number) => {
  if (statusCode >= 200 && statusCode < 300) {
    return (
      <Badge className="bg-success font-normal bg-[#cdfee1] rounded-full text-black shadow-none hover:bg-[#cdfee1]">
        Success
      </Badge>
    );
  } else if (statusCode >= 300 && statusCode < 400) {
    return (
      <Badge className="bg-success font-normal bg-[#ffef9d] rounded-full text-black shadow-none hover:bg-[#ffef9d]">
        Redirect
      </Badge>
    );
  } else {
    return (
      <Badge className="bg-success font-normal bg-[#fedad9] rounded-full text-[#8e1f0b] shadow-none hover:bg-[#fedad9]">
        Failed
      </Badge>
    );
  }
};

export const getScoreColor = (score: number): string => {
  if (score >= 90) return 'text-[#0C5132]';
  if (score >= 80) return 'text-[#ff9f43]';
  return 'text-red-600';
};

export const getStatusIcon = (value: boolean) => {
  return (
    <Image
      src={value ? '/images/check-green.svg' : '/images/close-icon.svg'}
      alt={value ? 'Check' : 'Close'}
      width={20}
      height={20}
    />
  );
};

export const getRelativeTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return `${diffInSeconds} seconds ago`;
  } else if (diffInSeconds < 3600) {
    return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  } else if (diffInSeconds < 86400) {
    return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  } else {
    return `${Math.floor(diffInSeconds / 86400)} days ago`;
  }
};

export const getFilterObject = (filterText: string): string => {
  if (!filterText) return '';

  const filterObj: { url?: string } = {};

  if (filterText) {
    filterObj.url = filterText;
  }

  return JSON.stringify(filterObj);
};

export const getSortParams = (
  value: string
): { sortField: string; sortOrder: 'asc' | 'desc' } => {
  switch (value) {
    case 'latest':
      return { sortField: 'crawledAt', sortOrder: 'desc' };
    case 'a-to-z':
      return { sortField: 'url', sortOrder: 'asc' };
    case 'z-to-a':
      return { sortField: 'url', sortOrder: 'desc' };
    case 'low-to-high':
      return { sortField: 'seoScore', sortOrder: 'asc' };
    case 'high-to-low':
      return { sortField: 'seoScore', sortOrder: 'desc' };
    default:
      return { sortField: 'crawledAt', sortOrder: 'desc' };
  }
};