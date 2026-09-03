import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isPmRole, isSuperAdminRole, normalizeProfileRole } from "@/lib/roles";
import {
  resolveAccessState,
  type AccessState,
} from "@/lib/accessState";
import type { Profile, ProfileRole } from "@/lib/types";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: ProfileRole | null;
  accessState: AccessState;
  /** True while the initial session is being resolved. */
  initializing: boolean;
  /** True while the current user's profile is loading. */
  profileLoading: boolean;
  /** True while a password recovery link is being handled. */
  isRecovering: boolean;
  isSuperAdmin: boolean;
  isPM: boolean;
  refreshProfile: () => Promise<void>;
  refreshSession: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  resendConfirmationEmail: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      if (activeUserIdRef.current !== userId) return;
      setProfile(data as Profile | null);
    } catch {
      if (activeUserIdRef.current !== userId) return;
      setProfile(null);
    } finally {
      if (activeUserIdRef.current !== userId) return;
      setProfileLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) throw error;
    activeUserIdRef.current = data.session?.user?.id ?? null;
    setSession(data.session);
    if (data.session?.user?.id) {
      await loadProfile(data.session.user.id);
    }
  }, [loadProfile]);

  useEffect(() => {
    let active = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      const nextUserId = nextSession?.user?.id ?? null;
      const userChanged = activeUserIdRef.current !== nextUserId;
      activeUserIdRef.current = nextUserId;
      setSession(nextSession);

      if (event === "PASSWORD_RECOVERY") {
        setIsRecovering(true);
      }

      // Wait for INITIAL_SESSION before leaving the auth bootstrap state.
      // getSession() alone can resolve before persisted storage is read, which
      // caused false logouts after external OAuth redirects.
      if (event === "INITIAL_SESSION") {
        setInitializing(false);
      }

      // Supabase can emit SIGNED_IN/TOKEN_REFRESHED again when a backgrounded
      // tab becomes active. Keep the existing profile (and protected route)
      // mounted for the same user so unsaved form state is not discarded.
      if (nextUserId && userChanged) {
        setProfile(null);
        setProfileLoading(true);
        void loadProfile(nextUserId);
      } else if (!nextUserId) {
        setProfile(null);
        setProfileLoading(false);
      }
    });

    const bootstrapTimeout = window.setTimeout(() => {
      if (!active) return;
      setInitializing((current) => (current ? false : current));
    }, 5000);

    return () => {
      active = false;
      window.clearTimeout(bootstrapTimeout);
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(() => {
    const redirectBase = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
    const role = profile ? normalizeProfileRole(profile.role) : null;
    const user = session?.user ?? null;
    const accessState = resolveAccessState({
      initializing,
      profileLoading,
      session,
      user,
      profile,
    });

    return {
      session,
      user,
      profile,
      role,
      accessState,
      initializing,
      profileLoading,
      isRecovering,
      isSuperAdmin: isSuperAdminRole(role),
      isPM: isPmRole(role),
      refreshProfile: async () => {
        if (session?.user?.id) await loadProfile(session.user.id);
      },
      refreshSession,
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
      async resendConfirmationEmail() {
        const email = session?.user?.email;
        if (!email) {
          throw new Error("No email address found for the current session.");
        }
        const { error } = await supabase.auth.resend({
          type: "signup",
          email,
          options: {
            emailRedirectTo: `${redirectBase}/login`,
          },
        });
        if (error) throw error;
      },
    };
  }, [session, profile, initializing, profileLoading, isRecovering, loadProfile, refreshSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
