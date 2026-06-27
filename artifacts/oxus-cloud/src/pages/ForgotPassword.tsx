import React, { useState } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, MailCheck, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isValidEmail } from "@/lib/validation";

export function ForgotPassword() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const emailValid = isValidEmail(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to send the reset email. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-logo-blue/20 to-transparent pointer-events-none" />
        <div className="z-10 flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-chart-4 flex items-center justify-center text-sidebar font-bold">O</div>
          <span className="font-serif font-bold text-xl tracking-wide text-[#D1E8FF]">OXUS Cloud</span>
        </div>
        <div className="z-10 max-w-md">
          <h1 className="text-4xl font-serif font-bold text-white mb-4">Forgot your password?</h1>
          <p className="text-sidebar-foreground/80 text-lg">No problem. We'll send you a secure link to set a new one.</p>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background relative">
        <div className="w-full max-w-md">
          {sent ? (
            <div className="space-y-6">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <MailCheck className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-foreground">Check your email</h2>
                <p className="text-muted-foreground mt-2">
                  If an account exists for <span className="font-medium text-foreground">{email}</span>,
                  you'll receive a password reset link shortly.
                </p>
              </div>
              <Button asChild variant="outline" className="w-full h-12">
                <Link href="/login">
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back to sign in
                </Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-3xl font-bold tracking-tight text-foreground">Reset password</h2>
                <p className="text-muted-foreground mt-2">Enter your email and we'll send you a reset link.</p>
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
                <Button type="submit" className="w-full h-12 text-md bg-primary text-primary-foreground hover:bg-primary/90" disabled={loading || !emailValid}>
                  {loading ? "Sending..." : "Send reset link"}
                </Button>
              </form>

              <div className="mt-8 text-center text-sm text-muted-foreground">
                <Link href="/login" className="text-primary font-medium hover:underline inline-flex items-center gap-1">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
