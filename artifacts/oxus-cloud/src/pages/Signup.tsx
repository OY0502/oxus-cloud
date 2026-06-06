import React, { useState } from "react";
import { Link, useLocation } from "wouter";
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
    <div className="min-h-screen flex bg-background">
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-logo-blue/20 to-transparent pointer-events-none" />
        <div className="absolute top-0 right-0 p-32 opacity-20 pointer-events-none">
          <svg width="400" height="400" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="20" width="60" height="60" rx="8" stroke="currentColor" strokeWidth="2" className="text-logo-blue" transform="rotate(15 50 50)" />
            <rect x="25" y="25" width="50" height="50" rx="6" stroke="currentColor" strokeWidth="2" className="text-logo-blue" transform="rotate(-10 50 50)" />
          </svg>
        </div>
        
        <div className="z-10 flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-chart-4 flex items-center justify-center text-sidebar font-bold">O</div>
          <span className="font-serif font-bold text-xl tracking-wide text-[#D1E8FF]">OXUS Cloud</span>
        </div>

        <div className="z-10 max-w-md">
          <h1 className="text-4xl font-serif font-bold text-white mb-4">Start your agency's next chapter.</h1>
          <p className="text-sidebar-foreground/80 text-lg">Join top agencies using OXUS Cloud to streamline their operations.</p>
        </div>
      </div>
      
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background relative">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-12">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold">O</div>
            <span className="font-serif font-bold text-xl tracking-wide text-primary">OXUS Cloud</span>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">Create account</h2>
            <p className="text-muted-foreground mt-2">Sign up for your workspace today.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" placeholder="Alex Designer" required className="bg-background h-12" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="alex@oxus.cloud" required className="bg-background h-12" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required className="bg-background h-12" />
            </div>
            <Button type="submit" className="w-full h-12 text-md bg-primary text-primary-foreground hover:bg-primary/90" disabled={loading}>
              {loading ? "Creating account..." : "Sign Up"}
            </Button>
          </form>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
