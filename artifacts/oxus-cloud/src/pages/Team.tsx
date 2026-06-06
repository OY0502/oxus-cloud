import React, { useState } from "react";
import { teamData } from "@/data/mock";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export function Team() {
  const [selectedMember, setSelectedMember] = useState<any>(null);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Team</h2>
          <p className="text-muted-foreground text-sm">Manage your contractors and employees.</p>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamData.map((member) => (
              <TableRow key={member.id} onClick={() => setSelectedMember(member)} className="cursor-pointer hover:bg-muted/50">
                <TableCell className="font-medium flex items-center gap-3">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={member.avatar} />
                    <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  {member.name}
                </TableCell>
                <TableCell>{member.role}</TableCell>
                <TableCell>
                  <Badge variant={member.status === 'active' ? 'default' : 'secondary'} className={member.status === 'active' ? 'bg-chart-2 hover:bg-chart-2/80' : ''}>
                    {member.status}
                  </Badge>
                </TableCell>
                <TableCell>${member.rate}/hr</TableCell>
                <TableCell>{member.location}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selectedMember} onOpenChange={() => setSelectedMember(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader className="flex flex-row items-center gap-4">
            <Avatar className="w-16 h-16">
              <AvatarImage src={selectedMember?.avatar} />
              <AvatarFallback>{selectedMember?.name?.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <SheetTitle>{selectedMember?.name}</SheetTitle>
              <SheetDescription>{selectedMember?.role}</SheetDescription>
            </div>
          </SheetHeader>
          {selectedMember && (
            <div className="mt-8 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-muted rounded-lg space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rate</span>
                  <p className="text-lg font-bold">${selectedMember.rate}/hr</p>
                </div>
                <div className="p-4 bg-muted rounded-lg space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</span>
                  <p className="text-sm font-medium">{selectedMember.location}</p>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-3">Recent Invoices</h4>
                <div className="space-y-2">
                  <div className="p-3 border border-border rounded-md flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">INV-001</span>
                    <span className="font-medium">$1,200</span>
                    <Badge variant="outline">Paid</Badge>
                  </div>
                  <div className="p-3 border border-border rounded-md flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">INV-002</span>
                    <span className="font-medium">$850</span>
                    <Badge variant="secondary">Pending</Badge>
                  </div>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
