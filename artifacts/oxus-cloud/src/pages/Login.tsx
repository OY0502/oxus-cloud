import React, { useState } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { BrandLogo } from "@/components/BrandLogo";
import { isValidEmail } from "@/lib/validation";
import {
  INTERNAL_ACCESS_MESSAGE,
  isAllowedInternalEmail,
} from "@/lib/internalAuth";

export function Login() {
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailValid = isValidEmail(email);
  const emailAllowed = emailValid && isAllowedInternalEmail(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!emailValid) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!isAllowedInternalEmail(email)) {
      setError(INTERNAL_ACCESS_MESSAGE);
      return;
    }

    setLoading(true);
    try {
      await signInWithPassword(email, password);
      // RedirectIfAuthenticated handles role-aware navigation after profile loads.
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to sign in. Please try again.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-sidebar via-[hsl(215,42%,16%)] to-[hsl(213,28%,24%)]" />
        <div className="absolute inset-0 bg-gradient-to-tr from-logo-blue/25 via-transparent to-periwinkle/15 pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_55%_at_15%_95%,hsl(var(--logo-blue)/0.2),transparent)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_88%_12%,hsl(var(--periwinkle)/0.16),transparent)] pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-sidebar/50 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 right-0 p-32 opacity-25 pointer-events-none">
          <svg width="400" height="400" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="2" className="text-logo-blue" />
            <circle cx="50" cy="50" r="30" stroke="currentColor" strokeWidth="2" className="text-logo-blue" />
          </svg>
        </div>
        
        <div className="z-10">
          <BrandLogo />
        </div>

        <div className="z-10 max-w-md">
          <h1 className="text-4xl font-serif font-bold text-white mb-4">Agency OS for modern teams.</h1>
          <p className="text-sidebar-foreground/80 text-lg">Manage projects, pipelines, and finance in one beautiful interface designed for clarity.</p>
        </div>
      </div>
      
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background relative">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-12">
            <BrandLogo textClassName="text-primary" />
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">Welcome back</h2>
            <p className="text-muted-foreground mt-2">{INTERNAL_ACCESS_MESSAGE}</p>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@oxus.agency"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-background h-12"
              />
              {email.length > 0 && !emailValid && (
                <p className="text-xs text-destructive">Enter a valid email address.</p>
              )}
              {email.length > 0 && emailValid && !emailAllowed && (
                <p className="text-xs text-destructive">{INTERNAL_ACCESS_MESSAGE}</p>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary font-medium hover:underline">Forgot password?</Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-background h-12"
              />
            </div>
            <Button type="submit" className="w-full h-12 text-md bg-primary text-primary-foreground hover:bg-primary/90" disabled={loading || !emailAllowed}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link href="/signup" className="text-primary font-medium hover:underline">Sign up</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
