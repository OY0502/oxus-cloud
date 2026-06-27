import React, { useEffect } from "react";
import { Redirect, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Spinner } from "@/components/ui/spinner";

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Spinner className="size-8 text-primary" />
    </div>
  );
}

/**
 * Wraps protected app routes. Unauthenticated users are kicked out to /login
 * and the page they tried to reach is preserved via the `next` query param.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, initializing, isRecovering } = useAuth();
  const [location] = useLocation();

  if (initializing) return <FullScreenLoader />;

  // Force the user to complete password recovery before using the app.
  if (isRecovering) {
    return <Redirect to="/reset-password" />;
  }

  if (!session) {
    const next = encodeURIComponent(location || "/");
    return <Redirect to={`/login?next=${next}`} />;
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
  const { session, initializing, isRecovering } = useAuth();

  if (initializing) return <FullScreenLoader />;

  if (session && !isRecovering) {
    return <Redirect to="/" />;
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
