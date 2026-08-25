import React, { useState } from "react";
import { Building2, ChevronDown, Plus, Target, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CrmQuickCreateDialogs, type CrmQuickCreateKind } from "@/components/crm/CrmQuickCreateDialogs";

type Props = {
  disabled?: boolean;
};

export function CrmAddRecordMenu({ disabled }: Props) {
  const [createKind, setCreateKind] = useState<CrmQuickCreateKind | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={disabled} aria-haspopup="menu" aria-label="Add record">
            <Plus className="w-4 h-4 mr-2" />Add record
            <ChevronDown className="w-4 h-4 ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Create CRM record</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateKind("company")}>
            <Building2 className="w-4 h-4 mr-2 shrink-0" />
            <div>
              <div className="font-medium">Company</div>
              <div className="text-xs text-muted-foreground">Add an organization manually</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreateKind("person")}>
            <User className="w-4 h-4 mr-2 shrink-0" />
            <div>
              <div className="font-medium">Person</div>
              <div className="text-xs text-muted-foreground">Add an individual contact</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreateKind("lead")}>
            <Target className="w-4 h-4 mr-2 shrink-0" />
            <div>
              <div className="font-medium">Lead</div>
              <div className="text-xs text-muted-foreground">Add a commercial opportunity</div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CrmQuickCreateDialogs kind={createKind} onKindChange={setCreateKind} />
    </>
  );
}
