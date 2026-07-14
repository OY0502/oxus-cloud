import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ClickupSetupUpdatePlan } from "@/hooks/api";
import { CLICKUP_TEMPLATE_VERSION } from "@/lib/clickup/template";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appliedTemplateVersion: number | null;
  plan: ClickupSetupUpdatePlan | null;
  busy?: boolean;
  onConfirm: () => Promise<void>;
};

function listItems(items: string[], emptyLabel: string, prefix?: string) {
  const rows = items.length > 0 ? items : [emptyLabel];
  return (
    <ul className="list-disc pl-5 text-muted-foreground space-y-1">
      {rows.map((item) => (
        <li key={item}>
          {prefix && !item.startsWith(prefix) ? `${prefix} ${item}` : item}
        </li>
      ))}
    </ul>
  );
}

export function UpdateClickupSetupDialog({
  open,
  onOpenChange,
  appliedTemplateVersion,
  plan,
  busy,
  onConfirm,
}: Props) {
  const willUpdate = plan?.will_update_automatically ?? plan?.will_update ?? [];
  const requiresManual = plan?.requires_manual_configuration ?? plan?.cannot_change_automatically ?? [];
  const willRemainUnchanged = plan?.will_remain_unchanged ?? plan?.will_not_change ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Update ClickUp setup</DialogTitle>
          <DialogDescription>
            Review what OXUS will change in ClickUp. Existing delivery-team configuration stays intact unless noted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-border p-3">
              <p className="text-muted-foreground">Current template version</p>
              <p className="font-medium">{appliedTemplateVersion ?? "Not applied"}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-muted-foreground">New template version</p>
              <p className="font-medium">{CLICKUP_TEMPLATE_VERSION}</p>
            </div>
          </div>

          {plan && (
            <>
              <div>
                <p className="font-medium mb-2">Will update automatically</p>
                {listItems(willUpdate, "No automatic feature changes required", "+")}
              </div>

              {requiresManual.length > 0 && (
                <div>
                  <p className="font-medium mb-2">Requires manual ClickUp configuration</p>
                  {listItems(requiresManual, "")}
                </div>
              )}

              <div>
                <p className="font-medium mb-2">Will remain unchanged</p>
                {listItems(willRemainUnchanged, "", "-")}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy || !plan}>
            {busy ? "Updating…" : "Update setup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
