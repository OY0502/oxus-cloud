import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { LayoutGrid, Database } from "lucide-react";
import {
  useClients,
  useContacts,
  useProjects,
  useQuotes,
  useInvoices,
  useTeamMembers,
} from "@/hooks/api";
import { APP_PAGES, filterSearchResults, type SearchResult } from "@/lib/search";
import { cn } from "@/lib/utils";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();

  const { data: clients = [] } = useClients();
  const { data: contacts = [] } = useContacts();
  const { data: projects = [] } = useProjects();
  const { data: quotes = [] } = useQuotes();
  const { data: invoices = [] } = useInvoices();
  const { data: team = [] } = useTeamMembers();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const recordResults = useMemo<SearchResult[]>(() => {
    const rows: SearchResult[] = [];

    for (const c of clients) {
      rows.push({
        id: `client-${c.id}`,
        kind: "record",
        recordType: "Client",
        title: c.name,
        subtitle: c.industry ?? c.website ?? undefined,
        href: "/contacts",
      });
    }
    for (const c of contacts) {
      rows.push({
        id: `contact-${c.id}`,
        kind: "record",
        recordType: "Contact",
        title: c.name,
        subtitle: c.company ?? c.email ?? undefined,
        href: "/contacts",
      });
    }
    for (const p of projects) {
      rows.push({
        id: `project-${p.id}`,
        kind: "record",
        recordType: "Project",
        title: p.name,
        subtitle: p.client_name ?? p.status,
        href: "/projects",
      });
    }
    for (const q of quotes) {
      rows.push({
        id: `quote-${q.id}`,
        kind: "record",
        recordType: "Quote",
        title: q.number || q.company,
        subtitle: q.organization?.name ?? q.company ?? q.project_type ?? undefined,
        href: `/quotes/${q.id}`,
      });
    }
    for (const inv of invoices) {
      rows.push({
        id: `invoice-${inv.id}`,
        kind: "record",
        recordType: "Invoice",
        title: inv.number,
        subtitle: inv.client_name ?? inv.status,
        href: "/invoices",
      });
    }
    for (const m of team) {
      rows.push({
        id: `team-${m.id}`,
        kind: "record",
        recordType: "Team member",
        title: m.name,
        subtitle: m.job_title ?? m.email ?? undefined,
        href: "/team",
      });
    }

    return rows;
  }, [clients, contacts, projects, quotes, invoices, team]);

  const pageResults = useMemo(() => filterSearchResults(APP_PAGES, query), [query]);
  const filteredRecords = useMemo(() => filterSearchResults(recordResults, query), [recordResults, query]);

  const navigate = (href: string) => {
    setOpen(false);
    setQuery("");
    setLocation(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex-1 max-w-md ml-auto relative group text-left"
      >
        <span className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sidebar-foreground/50 group-hover:text-sidebar-foreground transition-colors pointer-events-none">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </span>
        <span className="block w-full bg-sidebar-accent/50 border border-sidebar-border rounded-md pl-10 pr-4 py-2 text-sm text-sidebar-foreground/50 group-hover:text-sidebar-foreground/70 transition-all">
          Search pages, records… (⌘K)
        </span>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search pages, clients, projects, deals…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {pageResults.length > 0 && (
            <CommandGroup heading="Pages">
              {pageResults.map((item) => {
                const Icon = item.icon ?? LayoutGrid;
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.title} ${item.subtitle ?? ""}`}
                    onSelect={() => navigate(item.href)}
                    className="gap-3"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-logo-blue/20 text-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">{item.title}</span>
                      {item.subtitle && (
                        <span className="text-xs text-muted-foreground truncate">{item.subtitle}</span>
                      )}
                    </div>
                    <span className="ml-auto shrink-0 rounded border border-logo-blue/30 bg-logo-blue/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/70">
                      Page
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {pageResults.length > 0 && filteredRecords.length > 0 && <CommandSeparator />}

          {filteredRecords.length > 0 && (
            <CommandGroup heading="Records">
              {filteredRecords.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.title} ${item.subtitle ?? ""} ${item.recordType ?? ""}`}
                  onSelect={() => navigate(item.href)}
                  className="gap-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Database className="h-4 w-4" />
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{item.title}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {[item.recordType, item.subtitle].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      "border border-border bg-card text-muted-foreground",
                    )}
                  >
                    {item.recordType}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
