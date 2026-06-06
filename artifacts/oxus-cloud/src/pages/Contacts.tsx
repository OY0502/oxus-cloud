import React, { useState } from "react";
import { contactsData } from "@/data/mock";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function Contacts() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContact, setSelectedContact] = useState<any>(null);

  const filteredContacts = contactsData.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.company.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Contacts</h2>
          <p className="text-muted-foreground text-sm">Manage all your relationships.</p>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex justify-between items-center">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search contacts..." 
              className="pl-9 bg-background"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredContacts.map((contact) => (
              <TableRow key={contact.id} onClick={() => setSelectedContact(contact)} className="cursor-pointer hover:bg-muted/50">
                <TableCell className="font-medium flex items-center gap-3">
                  <Avatar className="w-8 h-8 bg-primary/10">
                    <AvatarFallback className="text-primary bg-primary/10">{contact.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  {contact.name}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={
                    contact.type === 'contractor' ? 'bg-chart-1/10 text-chart-1 border-chart-1/20' : 
                    contact.type === 'client' ? 'bg-chart-2/10 text-chart-2 border-chart-2/20' : 
                    contact.type === 'person' ? 'bg-primary/10 text-primary border-primary/20' : 
                    'bg-muted text-muted-foreground'
                  }>
                    {contact.type}
                  </Badge>
                </TableCell>
                <TableCell>{contact.company}</TableCell>
                <TableCell>{contact.email}</TableCell>
                <TableCell>{contact.phone}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selectedContact} onOpenChange={() => setSelectedContact(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader className="flex flex-row items-center gap-4">
            <Avatar className="w-16 h-16 bg-primary/10">
              <AvatarFallback className="text-primary text-xl bg-primary/10">{selectedContact?.name?.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <SheetTitle>{selectedContact?.name}</SheetTitle>
              <SheetDescription>{selectedContact?.company}</SheetDescription>
            </div>
          </SheetHeader>
          {selectedContact && (
            <div className="mt-8 space-y-6">
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg flex items-center gap-4">
                  <span className="text-sm font-medium text-muted-foreground w-16">Email</span>
                  <a href={`mailto:${selectedContact.email}`} className="text-sm font-medium hover:underline">{selectedContact.email}</a>
                </div>
                <div className="p-4 bg-muted rounded-lg flex items-center gap-4">
                  <span className="text-sm font-medium text-muted-foreground w-16">Phone</span>
                  <a href={`tel:${selectedContact.phone}`} className="text-sm font-medium hover:underline">{selectedContact.phone}</a>
                </div>
                <div className="p-4 bg-muted rounded-lg flex items-center gap-4">
                  <span className="text-sm font-medium text-muted-foreground w-16">Type</span>
                  <Badge variant="outline" className="capitalize">{selectedContact.type}</Badge>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
