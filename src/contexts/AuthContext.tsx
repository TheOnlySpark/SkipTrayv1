import React from "react";
import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';

type Profile = Database['public']['Tables']['profiles']['Row'];

interface SignUpResult {
  error: AuthError | null;
  userId: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /**
   * Signs up a new user with email + password.
   * tenant_id is injected into options.data so it flows into
   * raw_app_meta_data → handle_new_user trigger → profiles.tenant_id
   */
  signUp: (email: string, password: string, tenantId: string) => Promise<SignUpResult>;
  onlineUserIds: Set<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (data) {
      setProfile(data);
    } else if (error) {
      if (import.meta.env.DEV) console.error('Error fetching profile:', error);
    }
  };

  useEffect(() => {
    // Initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {

      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Realtime Presence tracking for users logged into a canteen
  useEffect(() => {
    if (!user?.id || !profile?.canteen_id) {
      setOnlineUserIds(new Set());
      return;
    }

    const channelName = `canteen_presence_${profile.canteen_id}`;
    const presenceChannel = supabase.channel(channelName, {
      config: {
        presence: { key: user.id }
      }
    });

    const syncPresence = () => {
      const state = presenceChannel.presenceState();
      const ids = new Set<string>();
      Object.keys(state).forEach(key => {
        ids.add(key);
        const metas = state[key] as any[];
        metas?.forEach(m => {
          if (m?.user_id) ids.add(m.user_id);
        });
      });
      if (user?.id) ids.add(user.id);
      setOnlineUserIds(ids);
    };

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        syncPresence();
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        setOnlineUserIds(prev => {
          const next = new Set(prev);
          next.add(key);
          newPresences?.forEach((p: any) => {
            if (p?.user_id) next.add(p.user_id);
          });
          return next;
        });
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        setOnlineUserIds(prev => {
          const next = new Set(prev);
          next.delete(key);
          leftPresences?.forEach((p: any) => {
            if (p?.user_id) next.delete(p.user_id);
          });
          return next;
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await presenceChannel.track({
              user_id: user.id,
              name: profile.name,
              role: profile.role,
              online_at: new Date().toISOString()
            });
            syncPresence();
          } catch (err) {
            console.error('Error tracking presence:', err);
          }
        }
      });

    return () => {
      presenceChannel.untrack().catch(() => {});
      supabase.removeChannel(presenceChannel);
    };
  }, [user?.id, profile?.canteen_id, profile?.name, profile?.role]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const signUp = async (email: string, password: string, tenantId: string): Promise<SignUpResult> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // tenant_id in options.data → raw_app_meta_data in JWT
        // Picked up by handle_new_user trigger → profiles.tenant_id
        data: { tenant_id: tenantId },
      },
    });
    return { error, userId: data.user?.id ?? null };
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile: () => user ? fetchProfile(user.id) : Promise.resolve(), signUp, onlineUserIds }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
