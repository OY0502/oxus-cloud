import type { LucideIcon } from "lucide-react";
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
  Settings,
  Cpu,
} from "lucide-react";

export type SearchResultKind = "page" | "record";

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle?: string;
  href: string;
  icon?: LucideIcon;
  recordType?: string;
}

export const APP_PAGES: SearchResult[] = [
  { id: "page-dashboard", kind: "page", title: "Dashboard", subtitle: "Overview & metrics", href: "/", icon: LayoutDashboard },
  { id: "page-pipeline", kind: "page", title: "Pipeline", subtitle: "Deals & sales stages", href: "/pipeline", icon: KanbanSquare },
  { id: "page-quotes", kind: "page", title: "Quotes", subtitle: "Proposals & estimates", href: "/quotes", icon: FileText },
  { id: "page-projects", kind: "page", title: "Projects", subtitle: "Active delivery work", href: "/projects", icon: Briefcase },
  { id: "page-calendar", kind: "page", title: "Calendar", subtitle: "Events & schedule", href: "/calendar", icon: CalendarDays },
  { id: "page-team", kind: "page", title: "Team", subtitle: "Roster & availability", href: "/team", icon: Users },
  { id: "page-contacts", kind: "page", title: "Contacts", subtitle: "People & relationships", href: "/contacts", icon: Contact2 },
  { id: "page-technologies", kind: "page", title: "Technologies", subtitle: "Stack & tooling catalog", href: "/technologies", icon: Cpu },
  { id: "page-invoices", kind: "page", title: "Invoices", subtitle: "Billing lifecycle", href: "/invoices", icon: Receipt },
  { id: "page-finance", kind: "page", title: "Finance", subtitle: "Cash flow & transactions", href: "/finance", icon: LineChart },
  { id: "page-settings", kind: "page", title: "Settings", subtitle: "Account & preferences", href: "/settings", icon: Settings },
];

export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return text.toLowerCase().includes(q);
}

export function filterSearchResults(results: SearchResult[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return results.slice(0, 8);
  return results
    .filter((r) => matchesQuery(`${r.title} ${r.subtitle ?? ""} ${r.recordType ?? ""}`, q))
    .slice(0, 12);
}
