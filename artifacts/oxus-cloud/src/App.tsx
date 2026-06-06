import React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppShell } from "@/components/AppShell";
import { Dashboard } from "@/pages/Dashboard";
import { Pipeline } from "@/pages/Pipeline";
import { Quotes } from "@/pages/Quotes";
import { Projects } from "@/pages/Projects";
import { Calendar } from "@/pages/Calendar";
import { Team } from "@/pages/Team";
import { Contacts } from "@/pages/Contacts";
import { Invoices } from "@/pages/Invoices";
import { Finance } from "@/pages/Finance";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/" component={() => <AppShell><Dashboard /></AppShell>} />
      <Route path="/pipeline" component={() => <AppShell><Pipeline /></AppShell>} />
      <Route path="/quotes" component={() => <AppShell><Quotes /></AppShell>} />
      <Route path="/projects" component={() => <AppShell><Projects /></AppShell>} />
      <Route path="/calendar" component={() => <AppShell><Calendar /></AppShell>} />
      <Route path="/team" component={() => <AppShell><Team /></AppShell>} />
      <Route path="/contacts" component={() => <AppShell><Contacts /></AppShell>} />
      <Route path="/invoices" component={() => <AppShell><Invoices /></AppShell>} />
      <Route path="/finance" component={() => <AppShell><Finance /></AppShell>} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
