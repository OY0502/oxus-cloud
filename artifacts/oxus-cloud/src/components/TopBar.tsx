import React from "react";
import { Search, Bell, Settings } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function TopBar({ title }: { title?: string }) {
  return (
    <header className="h-16 bg-sidebar text-sidebar-foreground flex items-center justify-between px-8 sticky top-0 z-10 border-b border-sidebar-border">
      <div className="flex items-center gap-6 flex-1">
        {title && <h1 className="text-lg font-medium text-[#D1E8FF]">{title}</h1>}
        
        <div className="flex-1 max-w-md ml-auto relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sidebar-foreground/50 group-focus-within:text-sidebar-foreground transition-colors" />
          <input 
            type="text" 
            placeholder="Search commands, clients, projects... (⌘K)" 
            className="w-full bg-sidebar-accent/50 border border-sidebar-border rounded-md pl-10 pr-4 py-2 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-1 focus:ring-sidebar-ring transition-all"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-4 ml-6">
        <button className="relative p-2 rounded-full hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-magenta rounded-full border-2 border-sidebar"></span>
        </button>
        <button className="p-2 rounded-full hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
