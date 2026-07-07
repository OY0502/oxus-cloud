import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isPmRole, isSuperAdminRole, normalizeProfileRole } from "@/lib/roles";
import type { Profile, ProfileRole } from "@/lib/types";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: ProfileRole | null;
  /** True while the initial session is being resolved. */
  initializing: boolean;
  /** True while the current user's profile is loading. */
  profileLoading: boolean;
  /** True while a password recovery link is being handled. */
  isRecovering: boolean;
  isSuperAdmin: boolean;
  isPM: boolean;
  refreshProfile: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      setProfile(data as Profile | null);
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setInitializing(false);
      if (data.session?.user?.id) {
        void loadProfile(data.session.user.id);
      } else {
        setProfile(null);
        setProfileLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setInitializing(false);
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovering(true);
      }
      if (nextSession?.user?.id) {
        void loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
        setProfileLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(() => {
    const redirectBase = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
    const role = profile ? normalizeProfileRole(profile.role) : null;

    return {
      session,
      user: session?.user ?? null,
      profile,
      role,
      initializing,
      profileLoading,
      isRecovering,
      isSuperAdmin: isSuperAdminRole(role),
      isPM: isPmRole(role),
      refreshProfile: async () => {
        if (session?.user?.id) await loadProfile(session.user.id);
      },
      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      },
      async signUp(email, password, fullName) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${redirectBase}/login`,
          },
        });
        if (error) throw error;
        const needsEmailConfirmation = !data.session;
        return { needsEmailConfirmation };
      },
      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        setProfile(null);
      },
      async sendPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${redirectBase}/reset-password`,
        });
        if (error) throw error;
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setIsRecovering(false);
      },
    };
  }, [session, profile, initializing, profileLoading, isRecovering, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
