import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function Signup() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLocation("/");
    }, 800);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md bg-card border-border shadow-2xl">
        <CardContent className="p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold mb-4">
              O
            </div>
            <h1 className="font-serif font-bold text-3xl tracking-wide text-primary">OXUS Cloud</h1>
            <p className="text-muted-foreground mt-2 text-sm">Create your workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" placeholder="Alex Designer" required className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="alex@oxus.cloud" required className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required className="bg-background" />
            </div>
            <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={loading}>
              {loading ? "Creating account..." : "Sign Up"}
            </Button>
          </form>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">Sign in</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
