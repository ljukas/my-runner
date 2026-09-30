import type { useRouter } from 'expo-router';

/** Back to the tabs from a root modal. why not `replace('/')`: over the tabs it pushes a second copy of them. */
export function leaveToTabs(router: ReturnType<typeof useRouter>): void {
  if (router.canDismiss()) router.dismissAll();
  else router.replace('/');
}
