import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import type { CurrentUser } from '@ximo/shared';
import { api, ApiError } from '@/lib/api';
import {
  cacheCurrentUser,
  clearCachedCurrentUser,
  getCachedCurrentUser,
} from '@/lib/current-user-cache';
import { isInvitationSetupActive } from '@/lib/invitation';
import { supabase } from '@/lib/supabase';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';
import { useConnectivityStore } from '@/store/connectivity';
import { isUiPreviewMode, previewCurrentUser } from '@/lib/ui-preview';

interface SessionContextValue {
  session: Session | null;
  currentUser: CurrentUser | null;
  loading: boolean;
  refreshUser(accessToken?: string): Promise<CurrentUser>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function isInvitationRoute(): boolean {
  return (
    typeof globalThis.location !== 'undefined' &&
    globalThis.location.pathname.includes('/accept-invitation')
  );
}

function shouldDeferProfileHydration(): boolean {
  return isInvitationSetupActive() || isInvitationRoute();
}

export function SessionProvider({ children }: PropsWithChildren) {
  const previewMode = isUiPreviewMode();
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<Session | null>(null);
  const refreshRequestRef = useRef<{
    userId: string | undefined;
    request: Promise<CurrentUser>;
  } | null>(null);
  const branchHydrated = useBranchStore((state) => state.hydrated);
  const reconcileBranch = useBranchStore((state) => state.reconcile);
  const clearBranch = useBranchStore((state) => state.clear);
  const apiOnline = useConnectivityStore((state) => state.isOnline);
  const connectivityInitialized = useConnectivityStore((state) => state.initialized);

  const refreshUser = useCallback(async (accessToken?: string) => {
    if (previewMode) {
      setCurrentUser(previewCurrentUser);
      return previewCurrentUser;
    }
    const currentSession =
      sessionRef.current ?? (await supabase.auth.getSession()).data.session ?? null;
    const userId = currentSession?.user.id;
    const existingRequest = refreshRequestRef.current;
    if (existingRequest && existingRequest.userId === userId) return existingRequest.request;

    const request = (async () => {
      try {
        const user = await api<CurrentUser>('/auth/current', { accessToken });
        // The API must never provide a workspace for a different signed-in account.
        if (userId && user.id !== userId) {
          throw new Error('The POS server returned a workspace for a different account.');
        }
        if (userId && sessionRef.current?.user.id !== userId) {
          throw new Error('The signed-in account changed while loading its workspace.');
        }
        setCurrentUser(user);
        // A workspace cache improves recovery only; storage failure must never block a live sign-in.
        void cacheCurrentUser(user).catch(() => undefined);
        return user;
      } catch (error) {
        // A locally saved context lets a returning user continue with the last
        // authorized workspace while the live service is temporarily unavailable.
        // Authentication failures and permission errors always stay live-only.
        if (error instanceof ApiError && error.code === 'OFFLINE' && userId) {
          const cachedUser = await getCachedCurrentUser(userId);
          if (cachedUser && sessionRef.current?.user.id === userId) {
            setCurrentUser(cachedUser);
            return cachedUser;
          }
        }
        throw error;
      }
    })();
    refreshRequestRef.current = { userId, request };
    try {
      return await request;
    } finally {
      if (refreshRequestRef.current?.request === request) {
        refreshRequestRef.current = null;
      }
    }
  }, [previewMode]);

  useEffect(() => {
    if (previewMode) {
      const previewSession = {
        access_token: 'preview-access-token',
        refresh_token: 'preview-refresh-token',
        expires_at: Math.floor(Date.now() / 1_000) + 86_400,
        user: { id: previewCurrentUser.id },
      } as Session;
      sessionRef.current = previewSession;
      setSession(previewSession);
      setCurrentUser(previewCurrentUser);
      // Pick the sample branch before releasing the route guard so the preview
      // opens the real dashboard instead of stopping at branch selection.
      void Promise.all([
        useBranchStore.getState().select(previewCurrentUser.branches[0]!),
        useShiftStore.getState().setActive({
          id: 'preview-shift',
          registerId: 'preview-register',
          registerName: 'Main Counter',
          branchId: previewCurrentUser.branches[0]!.id,
        }),
      ])
        .finally(() => setLoading(false));
      return;
    }
    void supabase.auth.getSession().then(async ({ data }) => {
      sessionRef.current = data.session;
      setSession(data.session);
      if (data.session && !shouldDeferProfileHydration()) {
        // A previously authorized workspace opens immediately while the live
        // service validates and refreshes it in the background.
        const cachedUser = await getCachedCurrentUser(data.session.user.id);
        if (cachedUser) {
          setCurrentUser(cachedUser);
          void refreshUser().catch(async (error) => {
            if (error instanceof ApiError && error.status === 401) {
              await supabase.auth.signOut();
            }
          });
        } else {
          try {
            await refreshUser();
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
              await supabase.auth.signOut();
            }
          }
        }
      }
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      sessionRef.current = nextSession;
      setSession(nextSession);
      if (!nextSession) {
        setCurrentUser(null);
        void clearBranch();
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        if (shouldDeferProfileHydration()) return;
        void refreshUser(nextSession.access_token).catch(async (error) => {
          if (error instanceof ApiError && error.status === 401) {
            await supabase.auth.signOut();
          }
        });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [clearBranch, previewMode, refreshUser]);

  useEffect(() => {
    if (!branchHydrated || !currentUser) return;
    void reconcileBranch(currentUser.branches);
  }, [branchHydrated, currentUser, reconcileBranch]);

  useEffect(() => {
    // Once the health probe sees the server again, finish any workspace load
    // that could not complete during the outage without making the user sign in twice.
    if (previewMode || !session || currentUser || !connectivityInitialized || !apiOnline) return;
    void refreshUser().catch(() => undefined);
  }, [apiOnline, connectivityInitialized, currentUser, previewMode, refreshUser, session]);

  useEffect(() => {
    if (previewMode || !session || shouldDeferProfileHydration()) return;
    let cancelled = false;
    let inFlight = false;
    let backoffMs = 0;
    let nextAllowedAt = 0;

    const refreshAccess = () => {
      if (cancelled || inFlight) return;
      const now = Date.now();
      if (now < nextAllowedAt) return;
      inFlight = true;
      void refreshUser()
        .then(() => {
          backoffMs = 0;
        })
        .catch((error) => {
          // Back off hard on rate limits so the app doesn't keep 429-spamming.
          if (error instanceof ApiError && error.status === 429) {
            backoffMs = Math.min(Math.max(backoffMs * 2, 60_000), 5 * 60_000);
            nextAllowedAt = Date.now() + backoffMs;
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAccess();
    });
    // Less aggressive than 60s — current-user rarely needs sub-minute polling.
    const refreshInterval = setInterval(refreshAccess, 5 * 60_000);
    return () => {
      cancelled = true;
      appStateSubscription.remove();
      clearInterval(refreshInterval);
    };
  }, [previewMode, refreshUser, session]);

  const value = useMemo(
    () => ({
      session,
      currentUser,
      loading,
      refreshUser,
      async signOut() {
        if (previewMode) return;
        const userId = sessionRef.current?.user.id;
        try {
          await supabase.auth.signOut();
        } finally {
          // Clear this device immediately even when the network request is delayed or fails.
          sessionRef.current = null;
          setSession(null);
          setCurrentUser(null);
          await Promise.allSettled([clearBranch(), clearCachedCurrentUser(userId)]);
        }
      },
    }),
    [clearBranch, session, currentUser, loading, previewMode, refreshUser],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
