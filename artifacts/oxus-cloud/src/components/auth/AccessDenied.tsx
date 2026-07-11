import React from "react";
import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BrandLogo } from "@/components/BrandLogo";
import { INTERNAL_ACCESS_MESSAGE } from "@/lib/internalAuth";

type AccessDeniedProps = {
  message?: string;
  onSignOut?: () => void;
};

export function AccessDenied({ message = INTERNAL_ACCESS_MESSAGE, onSignOut }: AccessDeniedProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-6">
        <BrandLogo textClassName="text-primary" />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">
          If you believe this is an error, contact your OXUS administrator.
        </p>
        <div className="flex gap-3">
          {onSignOut ? (
            <Button variant="outline" onClick={() => void onSignOut()}>
              Sign out
            </Button>
          ) : null}
          <Button asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
