import { confirmAppAction } from '@/providers/ios-alert';

export function confirmAction(
  title: string,
  message: string,
  confirmLabel = 'Continue',
): Promise<boolean> {
  return confirmAppAction(title, message, confirmLabel);
}
