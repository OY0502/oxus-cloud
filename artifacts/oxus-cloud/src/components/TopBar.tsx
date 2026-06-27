import React from "react";
import { Link } from "wouter";
import { Bell, Settings } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";

export function TopBar({ title }: { title?: string }) {
  return (
    <header className="h-16 bg-sidebar text-sidebar-foreground flex items-center justify-between px-8 sticky top-0 z-10 border-b border-sidebar-border">
      <div className="flex items-center gap-6 flex-1">
        {title && <h1 className="text-lg font-medium text-[#D1E8FF]">{title}</h1>}
        <GlobalSearch />
      </div>
      
      <div className="flex items-center gap-4 ml-6">
        <button type="button" className="relative p-2 rounded-full hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-magenta rounded-full border-2 border-sidebar"></span>
        </button>
        <Link
          href="/settings"
          className="p-2 rounded-full hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
        >
          <Settings className="w-5 h-5" />
        </Link>
      </div>
    </header>
  );
}
