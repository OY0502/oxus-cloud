import React, { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { BrandLogo } from "@/components/BrandLogo";
import { isValidEmail } from "@/lib/validation";

export function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailValid = isValidEmail(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithPassword(email, password);
      const params = new URLSearchParams(search);
      const next = params.get("next");
      setLocation(next ? decodeURIComponent(next) : "/");
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
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-logo-blue/20 to-transparent pointer-events-none" />
        <div className="absolute top-0 right-0 p-32 opacity-20 pointer-events-none">
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
            <p className="text-muted-foreground mt-2">Enter your credentials to access your workspace.</p>
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
            <Button type="submit" className="w-full h-12 text-md bg-primary text-primary-foreground hover:bg-primary/90" disabled={loading || !emailValid}>
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
