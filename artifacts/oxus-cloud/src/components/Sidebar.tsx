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
  LineChart,
  Cpu,
  LogOut,
  ChevronsUpDown,
  Settings,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { BrandLogo } from "@/components/BrandLogo";
import { filterPagesForRole } from "@/lib/roles";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Pipeline", href: "/pipeline", icon: KanbanSquare },
  { name: "Quotes", href: "/quotes", icon: FileText },
  { name: "Projects", href: "/projects", icon: Briefcase },
  { name: "Calendar", href: "/calendar", icon: CalendarDays },
  { name: "Team", href: "/team", icon: Users },
  { name: "Contacts", href: "/contacts", icon: Contact2 },
  { name: "Technologies", href: "/technologies", icon: Cpu },
  { name: "Invoices", href: "/invoices", icon: Receipt },
  { name: "Finance", href: "/finance", icon: LineChart },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Sidebar() {
  const [location] = useLocation();
  const { user, signOut, role } = useAuth();
  const visibleNavigation = filterPagesForRole(navigation, role);

  const email = user?.email ?? "";
  const fullName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    email.split("@")[0] ||
    "User";
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // onAuthStateChange + route guards will still redirect to /login.
    }
  };

  return (
    <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col fixed inset-y-0 z-20">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border bg-sidebar">
        <Link href="/">
          <BrandLogo />
        </Link>
      </div>
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {visibleNavigation.map((item) => {
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-sidebar-accent/50 transition-colors text-left outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring">
              <Avatar className="w-9 h-9 border border-sidebar-border">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName} />}
                <AvatarFallback className="bg-white text-primary font-semibold">{getInitials(fullName)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-medium text-sidebar-foreground truncate">{fullName}</span>
                <span className="text-xs text-sidebar-foreground/50 truncate">{email}</span>
              </div>
              <ChevronsUpDown className="w-4 h-4 text-sidebar-foreground/50 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleSignOut} className="text-destructive focus:text-destructive">
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
