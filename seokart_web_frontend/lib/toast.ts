type ToastType = 'success' | 'error' | 'info';

class ToastManager {
  private listeners: Array<(message: string, type: ToastType) => void> = [];

  subscribe(listener: (message: string, type: ToastType) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  show(message: string, type: ToastType = 'info') {
    this.listeners.forEach(listener => listener(message, type));
  }
}

export const toastManager = new ToastManager();

export const showToast = (message: string, type: ToastType = 'info') => {
  toastManager.show(message, type);
};