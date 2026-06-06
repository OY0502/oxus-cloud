import React from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  KanbanSquare, 
  FileText, 
  Briefcase, 
  CalendarDays, 
  Users, 
  Contact2, 
  Receipt, 
  LineChart 
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Pipeline", href: "/pipeline", icon: KanbanSquare },
  { name: "Quotes", href: "/quotes", icon: FileText },
  { name: "Projects", href: "/projects", icon: Briefcase },
  { name: "Calendar", href: "/calendar", icon: CalendarDays },
  { name: "Team", href: "/team", icon: Users },
  { name: "Contacts", href: "/contacts", icon: Contact2 },
  { name: "Invoices", href: "/invoices", icon: Receipt },
  { name: "Finance", href: "/finance", icon: LineChart },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col fixed inset-y-0 z-20">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border bg-sidebar">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-chart-4 flex items-center justify-center text-sidebar font-bold">O</div>
          <span className="font-serif font-bold text-xl tracking-wide text-[#D1E8FF]">OXUS Cloud</span>
        </Link>
      </div>
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link 
              key={item.name} 
              href={item.href} 
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                isActive 
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' 
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span className="text-sm">{item.name}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-sidebar-border bg-sidebar/95 backdrop-blur">
        <div className="flex items-center gap-3 p-2 rounded-md hover:bg-sidebar-accent/50 transition-colors cursor-pointer">
          <Avatar className="w-9 h-9 border border-sidebar-border">
            <AvatarImage src="https://i.pravatar.cc/150?u=a042581f4e29026704d" alt="Alex Designer" />
            <AvatarFallback>AD</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-sidebar-foreground">Alex Designer</span>
            <span className="text-xs text-sidebar-foreground/50">Admin</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
