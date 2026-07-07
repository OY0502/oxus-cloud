import { useCallback } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { isClickupOAuthRequired, isClickupTeamNotAuthorized } from "@/lib/edgeFunctionErrors";

export function useClickupOAuthHandler() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleError = useCallback(
    (error: unknown, fallbackTitle = "ClickUp action failed") => {
      if (isClickupOAuthRequired(error) || isClickupTeamNotAuthorized(error)) {
        toast({
          title: "Connect ClickUp first",
          description: error.message,
          variant: "destructive",
          action: (
            <button
              type="button"
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium"
              onClick={() => setLocation(error.redirectTo ?? "/settings?connect=clickup")}
            >
              Open Settings
            </button>
          ),
        });
        return true;
      }
      toast({
        title: fallbackTitle,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      return false;
    },
    [setLocation, toast],
  );

  const startConnect = useCallback(
    async (startOAuth: () => Promise<{ auth_url: string }>) => {
      const { auth_url } = await startOAuth();
      window.location.href = auth_url;
    },
    [],
  );

  return { handleError, startConnect };
}
