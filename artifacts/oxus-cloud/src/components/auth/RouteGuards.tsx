import React, { useEffect, useRef } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import {
  canAccessRoute,
  getDefaultHomeRoute,
  isSuperAdminRole,
} from "@/lib/roles";
import { isAllowedInternalEmail, INTERNAL_ACCESS_MESSAGE } from "@/lib/internalAuth";
import { isAccessResolved } from "@/lib/accessState";
import { AccessDenied } from "@/components/auth/AccessDenied";
import { EmailConfirmationRequired } from "@/components/auth/EmailConfirmationRequired";

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Spinner className="size-8 text-primary" />
    </div>
  );
}

function resolveAuthenticatedDestination(
  role: string | null,
  next: string | null,
): string {
  if (next) {
    const decoded = decodeURIComponent(next);
    if (canAccessRoute(role, decoded)) {
      return decoded;
    }
  }
  return getDefaultHomeRoute(role);
}

/**
 * Wraps protected app routes. Unauthenticated users are kicked out to /login
 * and the page they tried to reach is preserved via the `next` query param.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const {
    session,
    initializing,
    isRecovering,
    accessState,
    signOut,
  } = useAuth();
  const [location] = useLocation();
  const signedOutRef = useRef(false);

  useEffect(() => {
    if (!isAccessResolved(accessState) || !session || signedOutRef.current) return;
    if (accessState === "domain_not_allowed") {
      signedOutRef.current = true;
      void signOut();
    }
  }, [accessState, session, signOut]);

  if (!isAccessResolved(accessState)) return <FullScreenLoader />;

  if (isRecovering) {
    return <Redirect to="/reset-password" />;
  }

  if (!session) {
    const next = encodeURIComponent(location || "/");
    return <Redirect to={`/login?next=${next}`} />;
  }

  if (accessState === "email_not_confirmed") {
    return <EmailConfirmationRequired />;
  }

  if (accessState === "domain_not_allowed") {
    return (
      <AccessDenied
        message="Your account is not authorized for OXUS Cloud. Signup may have been blocked because your email is not on the internal allowlist."
        onSignOut={() => void signOut()}
      />
    );
  }

  if (accessState === "profile_inactive") {
    return (
      <AccessDenied
        message="Your account access has been deactivated. Contact your OXUS administrator."
        onSignOut={() => void signOut()}
      />
    );
  }

  return <>{children}</>;
}

/**
 * Blocks PM users from super-admin-only routes with a silent role-based redirect.
 */
export function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { session, accessState, isSuperAdmin, role } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  const hadAllowedAccessRef = useRef(false);
  const previousLocationRef = useRef(location);

  const accessReady = accessState === "allowed";

  useEffect(() => {
    if (accessReady) {
      hadAllowedAccessRef.current = true;
    }
  }, [accessReady]);

  useEffect(() => {
    if (!accessReady || isSuperAdmin || canAccessRoute(role, location)) {
      previousLocationRef.current = location;
      return;
    }

    const isManualNavigation =
      hadAllowedAccessRef.current &&
      previousLocationRef.current !== location &&
      canAccessRoute(role, previousLocationRef.current);

    if (isManualNavigation) {
      toast({
        title: "Access denied",
        description: "You do not have permission to access this page.",
        variant: "destructive",
      });
    }

    previousLocationRef.current = location;
  }, [accessReady, isSuperAdmin, role, location, toast]);

  if (!isAccessResolved(accessState) || !session) return <FullScreenLoader />;
  if (!accessReady) return <FullScreenLoader />;

  if (!isSuperAdmin && !canAccessRoute(role, location)) {
    return <Redirect to={getDefaultHomeRoute(role)} />;
  }

  return <>{children}</>;
}

/**
 * For auth pages (login/signup). Authenticated users are bounced to the app.
 */
export function RedirectIfAuthenticated({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, initializing, isRecovering, accessState, role, user } = useAuth();
  const search = useSearch();

  if (initializing || (session && !isAccessResolved(accessState))) {
    return <FullScreenLoader />;
  }

  const emailAllowed = user?.email ? isAllowedInternalEmail(user.email) : false;
  if (session && !isRecovering && accessState === "allowed" && (emailAllowed || role)) {
    const params = new URLSearchParams(search);
    const next = params.get("next");
    return <Redirect to={resolveAuthenticatedDestination(role, next)} />;
  }

  if (session && !isRecovering && accessState === "email_not_confirmed") {
    return <EmailConfirmationRequired />;
  }

  if (session && !isRecovering && accessState === "domain_not_allowed") {
    return (
      <AccessDenied message={INTERNAL_ACCESS_MESSAGE} />
    );
  }

  return <>{children}</>;
}

/**
 * Watches the session while inside the app and reacts to sign-out happening in
 * another tab or to the session expiring, redirecting to /login immediately.
 */
export function useAutoKickOut() {
  const { session, initializing } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!initializing && !session) {
      setLocation("/login");
    }
  }, [session, initializing, setLocation]);
}

/**
 * Redirects PM users away from `/` before any super-admin route renders.
 */
export function RoleLandingRedirect() {
  const { accessState, role } = useAuth();
  const [location] = useLocation();

  if (!isAccessResolved(accessState) || accessState !== "allowed") {
    return <FullScreenLoader />;
  }

  if (!isSuperAdminRole(role) && (location === "/" || location === "")) {
    return <Redirect to={getDefaultHomeRoute(role)} />;
  }

  return null;
}
