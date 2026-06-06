import React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";
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
      <Route path="/" component={() => <Layout><Dashboard /></Layout>} />
      <Route path="/pipeline" component={() => <Layout><Pipeline /></Layout>} />
      <Route path="/quotes" component={() => <Layout><Quotes /></Layout>} />
      <Route path="/projects" component={() => <Layout><Projects /></Layout>} />
      <Route path="/calendar" component={() => <Layout><Calendar /></Layout>} />
      <Route path="/team" component={() => <Layout><Team /></Layout>} />
      <Route path="/contacts" component={() => <Layout><Contacts /></Layout>} />
      <Route path="/invoices" component={() => <Layout><Invoices /></Layout>} />
      <Route path="/finance" component={() => <Layout><Finance /></Layout>} />
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
