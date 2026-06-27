import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Check, X, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  passwordRules,
  isPasswordValid,
  getPasswordStrength,
} from "@/lib/password";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/BrandLogo";

export function ResetPassword() {
  const [, setLocation] = useLocation();
  const { updatePassword } = useAuth();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;

    // The recovery token in the URL is exchanged for a session automatically
    // (detectSessionInUrl). Confirm a session exists before showing the form.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setHasRecoverySession(!!data.session);
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasRecoverySession(true);
        setCheckingSession(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordValid = isPasswordValid(password);
  const passwordsMatch = password.length > 0 && password === confirm;
  const canSubmit = passwordValid && passwordsMatch && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!passwordValid) {
      setError("Please choose a password that meets all the requirements.");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      setDone(true);
      // Sign out so the user re-authenticates with the new password.
      await supabase.auth.signOut();
      setTimeout(() => setLocation("/login"), 1800);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update your password. Please try again.",
      );
      setLoading(false);
    }
  };

  const strengthBarColor =
    strength.label === "strong"
      ? "bg-green-500"
      : strength.label === "good"
        ? "bg-emerald-500"
        : strength.label === "fair"
          ? "bg-amber-500"
          : "bg-destructive";

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-md">
        <div className="mb-10">
          <BrandLogo textClassName="text-primary" />
        </div>

        {checkingSession ? (
          <p className="text-muted-foreground">Verifying your reset link…</p>
        ) : done ? (
          <div className="space-y-6">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground">Password updated</h2>
              <p className="text-muted-foreground mt-2">
                Your password has been changed. Redirecting you to sign in…
              </p>
            </div>
          </div>
        ) : !hasRecoverySession ? (
          <div className="space-y-6">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This password reset link is invalid or has expired. Please request a new one.
              </AlertDescription>
            </Alert>
            <Button asChild className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/forgot-password">Request a new link</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">Set a new password</h2>
              <p className="text-muted-foreground mt-2">Choose a strong password for your account.</p>
            </div>

            {error && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-background h-12"
                />
                {password.length > 0 && (
                  <div className="pt-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn("h-full transition-all", strengthBarColor)}
                          style={{ width: `${strength.score}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground capitalize w-12 text-right">
                        {strength.label}
                      </span>
                    </div>
                    <ul className="grid grid-cols-1 gap-1">
                      {passwordRules.map((rule) => {
                        const ok = rule.test(password);
                        return (
                          <li
                            key={rule.id}
                            className={cn(
                              "flex items-center gap-2 text-xs",
                              ok ? "text-green-600" : "text-muted-foreground",
                            )}
                          >
                            {ok ? (
                              <Check className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <X className="w-3.5 h-3.5 shrink-0" />
                            )}
                            {rule.label}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="bg-background h-12"
                />
                {confirm.length > 0 && !passwordsMatch && (
                  <p className="text-xs text-destructive">Passwords do not match.</p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full h-12 text-md bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={!canSubmit}
              >
                {loading ? "Updating..." : "Update password"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
