import React, { useState } from "react";
import { contactsData } from "@/data/mock";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { EntityDrawer } from "@/components/EntityDrawer";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Mail, Phone, Building2, Calendar, MapPin, ExternalLink, MessageSquare, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function Contacts() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContact, setSelectedContact] = useState<any>(null);

  const filteredContacts = contactsData.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getTypeVariant = (type: string) => {
    switch (type.toLowerCase()) {
      case "client": return "success";
      case "lead": return "info";
      case "contractor": return "warning";
      case "partner": return "default";
      case "vendor": return "neutral";
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

  const columns = [
    {
      header: "Contact",
      accessorKey: "name" as const,
      cell: (item: any) => (
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9 border border-border">
            <AvatarFallback className="bg-primary/5 text-primary font-medium">
              {item.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">{item.email}</span>
          </div>
        </div>
      )
    },
    {
      header: "Type",
      accessorKey: "type" as const,
      cell: (item: any) => <StatusBadge status={item.type} variant={getTypeVariant(item.type)} />
    },
    {
      header: "Company",
      accessorKey: "company" as const,
      cell: (item: any) => (
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{item.company}</span>
        </div>
      )
    },
    {
      header: "Phone",
      accessorKey: "phone" as const,
      cell: (item: any) => <span className="text-muted-foreground">{item.phone}</span>
    },
    {
      header: "Last Contact",
      accessorKey: "lastContact" as const,
      cell: (item: any) => <span className="text-muted-foreground">{item.lastContact}</span>
    },
    {
      header: "Relationship",
      accessorKey: "relationshipStrength" as const,
      cell: (item: any) => <StatusBadge status={item.relationshipStrength} variant={getStrengthVariant(item.relationshipStrength)} />
    },
    {
      header: "Source",
      accessorKey: "source" as const,
      cell: (item: any) => <span className="text-muted-foreground">{item.source}</span>
    }
  ];

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      <PageHeader 
        title="Contacts" 
        subtitle="Manage leads, clients, and partners."
        actions={
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search contacts..." 
                className="pl-9 w-[250px] bg-card border-border shadow-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
              <Plus className="w-4 h-4" />
              Add Contact
            </Button>
          </div>
        }
      />

      <DataTable 
        data={filteredContacts} 
        columns={columns} 
        onRowClick={(item) => setSelectedContact(item)} 
      />

      <EntityDrawer
        open={!!selectedContact}
        onOpenChange={(open) => !open && setSelectedContact(null)}
        title={
          <div className="flex items-center gap-4">
            <Avatar className="w-14 h-14 border border-border shadow-sm">
              <AvatarFallback className="bg-primary/5 text-primary text-xl font-medium">
                {selectedContact?.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="text-2xl font-bold font-sans">{selectedContact?.name}</div>
              <div className="flex items-center gap-2 mt-1">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">{selectedContact?.company}</span>
                <span className="text-muted-foreground text-sm mx-1">•</span>
                <StatusBadge status={selectedContact?.type || ""} variant={getTypeVariant(selectedContact?.type || "")} className="text-[10px] py-0 px-1.5 h-4" />
              </div>
            </div>
          </div>
        }
        headerActions={
          <>
            <Button variant="outline" size="sm" className="gap-2">
              <Mail className="w-4 h-4" /> Email
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Phone className="w-4 h-4" /> Call
            </Button>
          </>
        }
      >
        {selectedContact && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-card shadow-sm border-border">
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Email Address</span>
                  <a href={`mailto:${selectedContact.email}`} className="font-medium text-foreground hover:text-logo-blue transition-colors flex items-center gap-2">
                    {selectedContact.email}
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                </CardContent>
              </Card>
              <Card className="bg-card shadow-sm border-border">
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Phone Number</span>
                  <a href={`tel:${selectedContact.phone}`} className="font-medium text-foreground hover:text-logo-blue transition-colors flex items-center gap-2">
                    {selectedContact.phone}
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                </CardContent>
              </Card>
              <Card className="bg-card shadow-sm border-border">
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Relationship</span>
                  <div>
                    <StatusBadge status={selectedContact.relationshipStrength} variant={getStrengthVariant(selectedContact.relationshipStrength)} />
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-card shadow-sm border-border">
                <CardContent className="p-4 flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Source</span>
                  <span className="font-medium">{selectedContact.source}</span>
                </CardContent>
              </Card>
            </div>

            {selectedContact.notes && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Notes</h3>
                <div className="p-4 bg-muted/30 rounded-xl border border-border text-sm leading-relaxed">
                  {selectedContact.notes}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Recent Activity</h3>
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border bg-card shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">Sent Proposal</span>
                      <span className="text-xs text-muted-foreground">Today, 2:45 PM</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Emailed the updated Q3 project proposal.</p>
                  </div>
                </div>

                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border bg-card shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">Discovery Call</span>
                      <span className="text-xs text-muted-foreground">3 days ago</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Discussed requirements and timelines.</p>
                  </div>
                </div>

                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10">
                    <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border bg-card shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">Initial Outreach</span>
                      <span className="text-xs text-muted-foreground">1 week ago</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Connected via LinkedIn regarding web services.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </EntityDrawer>
    </div>
  );
}
