import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import type { CurrentUser } from '@ximo/shared';
import { api, ApiError } from '@/lib/api';
import { isInvitationSetupActive } from '@/lib/invitation';
import { supabase } from '@/lib/supabase';

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
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async (accessToken?: string) => {
    const user = await api<CurrentUser>('/auth/current', { accessToken });
    setCurrentUser(user);
    return user;
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session && !shouldDeferProfileHydration()) {
        try {
          await refreshUser();
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            await supabase.auth.signOut();
          }
        }
      }
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setCurrentUser(null);
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
  }, [refreshUser]);

  useEffect(() => {
    if (!session || shouldDeferProfileHydration()) return;
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
  }, [refreshUser, session]);

  const value = useMemo(
    () => ({
      session,
      currentUser,
      loading,
      refreshUser,
      async signOut() {
        await supabase.auth.signOut();
        setCurrentUser(null);
      },
    }),
    [session, currentUser, loading, refreshUser],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
