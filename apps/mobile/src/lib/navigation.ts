import { router, type Href } from 'expo-router';

let lastTarget = '';
let lastNavigationAt = 0;
let lastBackAt = 0;

/** Focus an existing destination when possible, and ignore repeat taps during a transition. */
export function navigateOnce(href: Href) {
  const target = typeof href === 'string' ? href : JSON.stringify(href);
  const now = Date.now();
  if (target === lastTarget && now - lastNavigationAt < 900) return;
  lastTarget = target;
  lastNavigationAt = now;
  router.navigate(href);
}

export function goBackOnce(fallbackHref: Href) {
  const now = Date.now();
  if (now - lastBackAt < 500) return;
  lastBackAt = now;
  lastTarget = '';
  if (router.canGoBack()) router.back();
  else router.replace(fallbackHref);
}
