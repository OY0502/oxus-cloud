import React from "react";
import { Button } from "@/components/ui/button";
import { confidenceLabel } from "@/lib/crm/personRecordDisplay";
import { AlertCircle } from "lucide-react";

type CrmReviewBannerProps = {
  email?: string | null;
  suggestion?: { suggested_name: string; confidence: number; source: string } | null;
  onAccept: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onSuppress?: () => void;
  loading?: boolean;
};

export function CrmReviewBanner({
  email,
  suggestion,
  onAccept,
  onEdit,
  onDismiss,
  onSuppress,
  loading,
}: CrmReviewBannerProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-medium text-amber-900">Complete this contact</p>
            <p className="text-xs text-amber-800/90">
              {email
                ? `We found ${email} but do not have a confirmed name.`
                : "This contact needs a confirmed name."}
            </p>
          </div>
          {suggestion && (
            <div className="rounded-md border border-amber-200/80 bg-white/70 px-2.5 py-2 text-sm">
              <div className="font-medium">{suggestion.suggested_name}</div>
              <div className="text-xs text-muted-foreground">
                Based on email address · Confidence: {confidenceLabel(suggestion.confidence)}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {suggestion && (
              <Button size="sm" variant="default" className="h-8" disabled={loading} onClick={onAccept}>
                Accept suggestion
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8" onClick={onEdit}>
              Enter name manually
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={onDismiss}>
              Dismiss
            </Button>
            {onSuppress && (
              <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={onSuppress}>
                Suppress
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
