'use client';

import { Toast as ToastType } from '@/hooks/useToast';

interface ToastProps {
  toast: ToastType;
  onRemove: (id: string) => void;
}

export const Toast = ({ toast, onRemove }: ToastProps) => {
  const { id, message, type } = toast;

  const bgColors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
  };

  return (
    <div
      className={`${bgColors[type]} text-white px-6 py-4 rounded-lg shadow-lg flex items-center justify-between min-w-[300px] animate-slide-in`}
    >
      <span>{message}</span>
      <button
        onClick={() => onRemove(id)}
        className="ml-4 text-white hover:text-gray-200 transition-colors"
      >
        ×
      </button>
    </div>
  );
};
