import React, { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { EntityDrawer } from "@/components/EntityDrawer";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Mail, Phone, Building2, ExternalLink, Plus, Contact2, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useContacts, useClients } from "@/hooks/api";
import { CreateContactDialog, CreateClientDialog } from "@/components/forms/CreateDialogs";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Client } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";

type Tab = "people" | "organizations";

export function Contacts() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("people");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<Client | null>(null);
  const [createPersonOpen, setCreatePersonOpen] = useState(false);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);

  // Deep-link support: ?tab=organizations&new=1 (used by combobox "add new").
  useEffect(() => {
    const params = new URLSearchParams(search);
    const t = params.get("tab");
    if (t === "organizations" || t === "people") setTab(t);
    if (params.get("new") === "1") {
      if (!isSuperAdmin) {
        toast({
          title: "Only super admins can do this",
          description: "Ask a super admin to add this client or contact.",
          variant: "destructive",
        });
        navigate(`/contacts?tab=${t ?? "people"}`, { replace: true });
        return;
      }
      if (t === "organizations") setCreateOrgOpen(true);
      else setCreatePersonOpen(true);
    }
  }, [search, isSuperAdmin, navigate, toast]);

  const contactsQuery = useContacts();
  const clientsQuery = useClients();

  const contacts = contactsQuery.data ?? [];
  const clients = clientsQuery.data ?? [];

  const getTypeVariant = (type: string) => {
    switch (type.toLowerCase()) {
      case "client": return "success";
      case "contractor": return "warning";
      case "agent": return "info";
      default: return "neutral";
    }
  };

  const getStrengthVariant = (strength: string) => {
    switch (strength.toLowerCase()) {
      case "strong": return "success";
      case "medium": return "warning";
      case "weak": return "danger";
      case "new": return "info";
      default: return "neutral";
    }
  };

  const lastContactLabel = (iso: string | null) =>
    iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—";

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.company ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.email ?? "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredOrgs = clients.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.industry ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.website ?? "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const peopleColumns = [
    {
      id: "contact",
      header: "Contact",
      cell: (item: Contact) => (
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9 border border-border">
            <AvatarFallback className="bg-primary/5 text-primary font-medium">{item.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">{item.email}</span>
          </div>
        </div>
      ),
    },
    { id: "type", header: "Type", cell: (item: Contact) => <StatusBadge status={item.type} variant={getTypeVariant(item.type)} /> },
    {
      id: "company",
      header: "Company",
      cell: (item: Contact) => (
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{item.company ?? "—"}</span>
        </div>
      ),
    },
    { id: "phone", header: "Phone", cell: (item: Contact) => <span className="text-muted-foreground">{item.phone ?? "—"}</span> },
    { id: "last_contact", header: "Last Contact", cell: (item: Contact) => <span className="text-muted-foreground">{lastContactLabel(item.last_contact_at)}</span> },
    { id: "relationship", header: "Relationship", cell: (item: Contact) => <StatusBadge status={item.relationship_strength} variant={getStrengthVariant(item.relationship_strength)} /> },
    { id: "source", header: "Source", cell: (item: Contact) => <span className="text-muted-foreground">{item.source ?? "—"}</span> },
  ];

  const orgColumns = [
    {
      id: "organization",
      header: "Organization",
      cell: (item: Client) => (
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9 border border-border">
            <AvatarFallback className="bg-primary/5 text-primary font-medium">{item.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <span className="font-medium">{item.name}</span>
        </div>
      ),
    },
    { id: "industry", header: "Industry", cell: (item: Client) => <span className="text-muted-foreground">{item.industry ?? "—"}</span> },
    {
      id: "website",
      header: "Website",
      cell: (item: Client) =>
        item.website ? (
          <a href={item.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-logo-blue hover:underline flex items-center gap-1">
            {item.website.replace(/^https?:\/\//, "")}<ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: "people", header: "People", cell: (item: Client) => <span className="text-muted-foreground">{contacts.filter((c) => c.client_id === item.id).length}</span> },
  ];

  const isPeople = tab === "people";
  const activeQuery = isPeople ? contactsQuery : clientsQuery;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        subtitle="Manage people and the organizations they belong to."
        actions={
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={isPeople ? "Search people..." : "Search organizations..."}
                className="pl-9 w-[250px] bg-card border-card-border shadow-soft"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {isSuperAdmin && (
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                onClick={() => (isPeople ? setCreatePersonOpen(true) : setCreateOrgOpen(true))}
              >
                <Plus className="w-4 h-4" />
                {isPeople ? "Add Person" : "Add Organization"}
              </Button>
            )}
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setSearchTerm(""); navigate(`/contacts?tab=${v}`, { replace: true }); }}>
        <TabsList className="bg-muted/50 p-1 border border-border">
          <TabsTrigger value="people" className="gap-2"><Contact2 className="h-4 w-4" /> People</TabsTrigger>
          <TabsTrigger value="organizations" className="gap-2"><Building2 className="h-4 w-4" /> Organizations</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeQuery.isLoading ? (
        <TableSkeleton columns={isPeople ? 7 : 4} />
      ) : activeQuery.isError ? (
        <ErrorState error={activeQuery.error} onRetry={() => activeQuery.refetch()} />
      ) : isPeople ? (
        contacts.length === 0 ? (
          <EmptyState
            icon={<Contact2 />}
            title="No people yet"
            description="Add clients, leads, partners and vendors to keep every relationship in one place."
            action={isSuperAdmin ? <Button onClick={() => setCreatePersonOpen(true)}><Plus className="w-4 h-4 mr-2" />Add your first person</Button> : undefined}
          />
        ) : filteredContacts.length === 0 ? (
          <EmptyState icon={<Search />} title="No matches" description={`No people match "${searchTerm}".`} />
        ) : (
          <DataTable tableId="contacts-people" data={filteredContacts} columns={peopleColumns} onRowClick={(item) => setSelectedContact(item)} />
        )
      ) : clients.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No organizations yet"
          description="Add the companies you work with to link them to people, quotes and projects."
          action={isSuperAdmin ? <Button onClick={() => setCreateOrgOpen(true)}><Plus className="w-4 h-4 mr-2" />Add your first organization</Button> : undefined}
        />
      ) : filteredOrgs.length === 0 ? (
        <EmptyState icon={<Search />} title="No matches" description={`No organizations match "${searchTerm}".`} />
      ) : (
        <DataTable tableId="contacts-organizations" data={filteredOrgs} columns={orgColumns} onRowClick={(item) => setSelectedOrg(item)} />
      )}

      <CreateContactDialog open={createPersonOpen} onOpenChange={setCreatePersonOpen} />
      <CreateClientDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />

      <EntityDrawer
        open={!!selectedContact}
        onOpenChange={(open) => !open && setSelectedContact(null)}
        title={
          <div className="flex items-center gap-4">
            <Avatar className="w-14 h-14 border border-border shadow-sm">
              <AvatarFallback className="bg-primary/5 text-primary text-xl font-medium">{selectedContact?.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="text-2xl font-bold font-sans">{selectedContact?.name}</div>
              <div className="flex items-center gap-2 mt-1">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">{selectedContact?.company ?? "—"}</span>
                <span className="text-muted-foreground text-sm mx-1">•</span>
                <StatusBadge status={selectedContact?.type || ""} variant={getTypeVariant(selectedContact?.type || "")} className="text-[10px] py-0 px-1.5 h-4" />
              </div>
            </div>
          </div>
        }
        headerActions={
          <>
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <a href={selectedContact?.email ? `mailto:${selectedContact.email}` : undefined}><Mail className="w-4 h-4" /> Email</a>
            </Button>
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <a href={selectedContact?.phone ? `tel:${selectedContact.phone}` : undefined}><Phone className="w-4 h-4" /> Call</a>
            </Button>
          </>
        }
      >
        {selectedContact && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Email Address</span>
                  <a href={`mailto:${selectedContact.email}`} className="font-medium text-foreground hover:text-logo-blue transition-colors flex items-center gap-2">
                    {selectedContact.email ?? "—"}
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Phone Number</span>
                  <a href={`tel:${selectedContact.phone}`} className="font-medium text-foreground hover:text-logo-blue transition-colors flex items-center gap-2">
                    {selectedContact.phone ?? "—"}
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Relationship</span>
                  <div><StatusBadge status={selectedContact.relationship_strength} variant={getStrengthVariant(selectedContact.relationship_strength)} /></div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Source</span>
                  <span className="font-medium">{selectedContact.source ?? "—"}</span>
                </CardContent>
              </Card>
            </div>

            {selectedContact.notes && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Notes</h3>
                <div className="p-4 bg-muted/30 rounded-xl border border-border text-sm leading-relaxed">{selectedContact.notes}</div>
              </div>
            )}
          </div>
        )}
      </EntityDrawer>

      <EntityDrawer
        open={!!selectedOrg}
        onOpenChange={(open) => !open && setSelectedOrg(null)}
        title={
          <div className="flex items-center gap-4">
            <Avatar className="w-14 h-14 border border-border shadow-sm">
              <AvatarFallback className="bg-primary/5 text-primary text-xl font-medium">{selectedOrg?.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="text-2xl font-bold font-sans">{selectedOrg?.name}</div>
              <div className="text-muted-foreground text-sm mt-1">{selectedOrg?.industry ?? "—"}</div>
            </div>
          </div>
        }
        headerActions={
          selectedOrg?.website ? (
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <a href={selectedOrg.website} target="_blank" rel="noreferrer"><Globe className="w-4 h-4" /> Visit</a>
            </Button>
          ) : undefined
        }
      >
        {selectedOrg && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Website</span>
                  <span className="font-medium">{selectedOrg.website ?? "—"}</span>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Industry</span>
                  <span className="font-medium">{selectedOrg.industry ?? "—"}</span>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">People at {selectedOrg.name}</h3>
              {contacts.filter((c) => c.client_id === selectedOrg.id).length === 0 ? (
                <p className="text-sm text-muted-foreground">No people linked to this organization yet.</p>
              ) : (
                <div className="space-y-2">
                  {contacts.filter((c) => c.client_id === selectedOrg.id).map((c) => (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
                      <Avatar className="w-8 h-8"><AvatarFallback className="bg-primary/5 text-primary text-xs">{c.name.charAt(0)}</AvatarFallback></Avatar>
                      <div className="flex flex-col"><span className="text-sm font-medium">{c.name}</span><span className="text-xs text-muted-foreground">{c.email ?? "—"}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedOrg.notes && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Notes</h3>
                <div className="p-4 bg-muted/30 rounded-xl border border-border text-sm leading-relaxed">{selectedOrg.notes}</div>
              </div>
            )}
          </div>
        )}
      </EntityDrawer>
    </div>
  );
}
