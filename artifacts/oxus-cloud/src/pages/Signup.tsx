import React, { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Check, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  passwordRules,
  isPasswordValid,
  getPasswordStrength,
} from "@/lib/password";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/BrandLogo";
import { isValidEmail } from "@/lib/validation";

export function Signup() {
  const [, setLocation] = useLocation();
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordValid = isPasswordValid(password);
  const passwordsMatch = password.length > 0 && password === confirm;
  const emailValid = isValidEmail(email);
  const canSubmit = emailValid && passwordValid && passwordsMatch && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!emailValid) {
      setError("Please enter a valid email address.");
      return;
    }
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
      const { needsEmailConfirmation } = await signUp(
        email,
        password,
        fullName,
      );
      if (needsEmailConfirmation) {
        setConfirmationSent(true);
        setLoading(false);
      } else {
        setLocation("/");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create your account. Please try again.",
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
    <div className="min-h-screen flex bg-background">
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-logo-blue/20 to-transparent pointer-events-none" />
        <div className="absolute top-0 right-0 p-32 opacity-20 pointer-events-none">
          <svg width="400" height="400" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="20" width="60" height="60" rx="8" stroke="currentColor" strokeWidth="2" className="text-logo-blue" transform="rotate(15 50 50)" />
            <rect x="25" y="25" width="50" height="50" rx="6" stroke="currentColor" strokeWidth="2" className="text-logo-blue" transform="rotate(-10 50 50)" />
          </svg>
        </div>
        
        <div className="z-10">
          <BrandLogo />
        </div>

        <div className="z-10 max-w-md">
          <h1 className="text-4xl font-serif font-bold text-white mb-4">Start your agency's next chapter.</h1>
          <p className="text-sidebar-foreground/80 text-lg">Join top agencies using OXUS Cloud to streamline their operations.</p>
        </div>
      </div>
      
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background relative">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-12">
            <BrandLogo textClassName="text-primary" />
          </div>

          {confirmationSent ? (
            <div className="space-y-6">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Check className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-foreground">Check your inbox</h2>
                <p className="text-muted-foreground mt-2">
                  We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>.
                  Confirm your email to activate your account, then sign in.
                </p>
              </div>
              <Button asChild className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-3xl font-bold tracking-tight text-foreground">Create account</h2>
                <p className="text-muted-foreground mt-2">Sign up for your workspace today.</p>
              </div>

              {error && (
                <Alert variant="destructive" className="mb-6">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    autoComplete="name"
                    placeholder="Alex Designer"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="bg-background h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="alex@oxus.cloud"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-background h-12"
                  />
                  {email.length > 0 && !emailValid && (
                    <p className="text-xs text-destructive">Enter a valid email address.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
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
                  <Label htmlFor="confirm">Confirm Password</Label>
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
                  {loading ? "Creating account..." : "Sign Up"}
                </Button>
              </form>

              <div className="mt-8 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary font-medium hover:underline">Sign in</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
