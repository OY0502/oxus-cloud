import { isAllowedInternalEmail } from "@/lib/internalAuth";
import type { Profile } from "@/lib/types";
import type { Session, User } from "@supabase/supabase-js";

export type AccessState =
  | "loading_auth"
  | "loading_profile"
  | "email_not_confirmed"
  | "domain_not_allowed"
  | "profile_inactive"
  | "allowed"
  | "forbidden_role";

export function isEmailConfirmed(user: User | null | undefined): boolean {
  return !!user?.email_confirmed_at;
}

export function resolveAccessState(input: {
  initializing: boolean;
  profileLoading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
}): AccessState {
  const { initializing, profileLoading, session, user, profile } = input;

  if (initializing) return "loading_auth";
  if (!session) return "allowed";

  const email = user?.email ?? profile?.email ?? null;

  if (profileLoading) return "loading_profile";

  if (!email || !isAllowedInternalEmail(email)) {
    return "domain_not_allowed";
  }

  if (!isEmailConfirmed(user)) {
    return "email_not_confirmed";
  }

  if (!profile) {
    return "domain_not_allowed";
  }

  if (profile.access_status === "blocked") {
    return "profile_inactive";
  }

  if (profile.access_status === "pending") {
    return "email_not_confirmed";
  }

  return "allowed";
}

export function isAccessResolved(state: AccessState): boolean {
  return state !== "loading_auth" && state !== "loading_profile";
}

export function canUseInternalApis(state: AccessState): boolean {
  return state === "allowed";
}
