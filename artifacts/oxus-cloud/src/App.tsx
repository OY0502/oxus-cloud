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
import { Technologies } from "@/pages/Technologies";
import { QuoteForm } from "@/pages/QuoteForm";
import { QuoteDetail } from "@/pages/QuoteDetail";
import { ProjectWizard } from "@/pages/ProjectWizard";
import { ProjectDetail } from "@/pages/ProjectDetail";
import { Invoices } from "@/pages/Invoices";
import { Finance } from "@/pages/Finance";
import { Settings } from "@/pages/Settings";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import { ForgotPassword } from "@/pages/ForgotPassword";
import { ResetPassword } from "@/pages/ResetPassword";
import { AuthProvider } from "@/contexts/AuthContext";
import {
  RequireAuth,
  RedirectIfAuthenticated,
  RequireSuperAdmin,
} from "@/components/auth/RouteGuards";

const queryClient = new QueryClient();

function protectedPage(Page: React.ComponentType) {
  return () => (
    <RequireAuth>
      <AppShell>
        <Page />
      </AppShell>
    </RequireAuth>
  );
}

function protectedSuperAdminPage(Page: React.ComponentType) {
  return () => (
    <RequireAuth>
      <RequireSuperAdmin>
        <AppShell>
          <Page />
        </AppShell>
      </RequireSuperAdmin>
    </RequireAuth>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login">
        <RedirectIfAuthenticated>
          <Login />
        </RedirectIfAuthenticated>
      </Route>
      <Route path="/signup">
        <RedirectIfAuthenticated>
          <Signup />
        </RedirectIfAuthenticated>
      </Route>
      <Route path="/forgot-password">
        <RedirectIfAuthenticated>
          <ForgotPassword />
        </RedirectIfAuthenticated>
      </Route>
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/" component={protectedSuperAdminPage(Dashboard)} />
      <Route path="/pipeline" component={protectedSuperAdminPage(Pipeline)} />
      <Route path="/quotes" component={protectedSuperAdminPage(Quotes)} />
      <Route path="/quotes/new" component={protectedSuperAdminPage(QuoteForm)} />
      <Route path="/quotes/:id" component={protectedSuperAdminPage(QuoteDetail)} />
      <Route path="/projects" component={protectedPage(Projects)} />
      <Route path="/projects/new" component={protectedPage(ProjectWizard)} />
      <Route path="/projects/:id/edit" component={protectedPage(ProjectWizard)} />
      <Route path="/projects/:id" component={protectedPage(ProjectDetail)} />
      <Route path="/calendar" component={protectedPage(Calendar)} />
      <Route path="/team" component={protectedPage(Team)} />
      <Route path="/contacts" component={protectedPage(Contacts)} />
      <Route path="/technologies" component={protectedSuperAdminPage(Technologies)} />
      <Route path="/invoices" component={protectedSuperAdminPage(Invoices)} />
      <Route path="/finance" component={protectedSuperAdminPage(Finance)} />
      <Route path="/settings" component={protectedPage(Settings)} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
