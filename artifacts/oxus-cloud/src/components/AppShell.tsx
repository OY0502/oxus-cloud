import React from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAutoKickOut } from "@/components/auth/RouteGuards";

const navigationMap: Record<string, string> = {
  "/": "Dashboard",
  "/pipeline": "Pipeline",
  "/quotes": "Quotes",
  "/projects": "Projects",
  "/calendar": "Calendar",
  "/team": "Team",
  "/contacts": "Contacts",
  "/invoices": "Invoices",
  "/finance": "Finance",
  "/settings": "Settings",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const currentTitle = navigationMap[location] || "Dashboard";
  useAutoKickOut();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <TopBar title={currentTitle} />
        
        <div className="flex-1 p-8 overflow-x-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={location}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="h-full flex flex-col"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
