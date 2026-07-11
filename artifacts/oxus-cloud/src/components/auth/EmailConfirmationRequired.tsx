import React, { useState } from "react";
import { Link } from "wouter";
import { AlertCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/contexts/AuthContext";

export function EmailConfirmationRequired() {
  const { user, resendConfirmationEmail, signOut } = useAuth();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = user?.email ?? "your email";

  const handleResend = async () => {
    setError(null);
    setSending(true);
    try {
      await resendConfirmationEmail();
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to resend the confirmation email. Please try again.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-6">
        <BrandLogo textClassName="text-primary" />
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Mail className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Confirm your email
          </h1>
          <p className="text-muted-foreground mt-2">
            Please confirm your email before accessing OXUS Cloud. We sent a link to{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {sent && (
          <Alert>
            <AlertDescription>
              Confirmation email sent. Check your inbox and spam folder.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-3">
          <Button onClick={() => void handleResend()} disabled={sending}>
            {sending ? "Sending..." : "Resend confirmation email"}
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
