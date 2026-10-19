'use client';

import {toast as sonnerToast, Toaster} from 'sonner';

export const toast = sonnerToast;

export function ToastProvider() {
  return <Toaster position="top-center" />;
}
