import { cva } from 'class-variance-authority';

export const usageBarVariants = cva('h-2 rounded-full transition-all duration-300', {
  variants: {
    variant: {
      default: 'bg-blue-500',
      yellow: 'bg-yellow-400',
      red: 'bg-red-500',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});
