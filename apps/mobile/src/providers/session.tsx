import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import type { CurrentUser } from '@ximo/shared';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';

interface SessionContextValue {
  session: Session | null;
  currentUser: CurrentUser | null;
  loading: boolean;
  refreshUser(accessToken?: string): Promise<CurrentUser>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

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
      if (data.session) {
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
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setCurrentUser(null);
    });
    return () => data.subscription.unsubscribe();
  }, [refreshUser]);

  useEffect(() => {
    if (!session) return;
    const refreshAccess = () => {
      void refreshUser().catch(() => undefined);
    };
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAccess();
    });
    const refreshInterval = setInterval(refreshAccess, 60_000);
    return () => {
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
