import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { CurrentUser } from '@ximo/shared';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

interface SessionContextValue {
  session: Session | null;
  currentUser: CurrentUser | null;
  loading: boolean;
  refreshUser(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshUser() {
    const user = await api<CurrentUser>('/auth/current');
    setCurrentUser(user);
  }

  useEffect(() => {
    void supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) {
        try {
          await refreshUser();
        } catch {
          await supabase.auth.signOut();
        }
      }
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setCurrentUser(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

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
    [session, currentUser, loading],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
