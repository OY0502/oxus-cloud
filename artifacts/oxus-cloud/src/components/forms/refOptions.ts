import { useMemo } from "react";
import { useClients, useContacts, useTechnologies, useProfiles, useCrmImportCandidates, useQuotes } from "@/hooks/api";
import { profileDisplayName } from "@/lib/profiles";
import type { SearchableOption } from "@/components/forms/SearchableSelect";

export function useOrganizationOptions(): SearchableOption[] {
  const { data = [] } = useClients();
  const candidatesQuery = useCrmImportCandidates();
  const quotesQuery = useQuotes();

  return useMemo(() => {
    const base = data.map((c) => ({
      value: c.id,
      label: c.name,
      sublabel: c.industry ?? c.website ?? c.primary_domain ?? undefined,
    }));

    const fromQuotes = (quotesQuery.data ?? [])
      .filter((q) => q.organization_id && !base.some((b) => b.value === q.organization_id))
      .map((q) => ({
        value: q.organization_id!,
        label: q.company ?? "Proposal company",
        sublabel: "From proposal",
      }));

    const suggested = (candidatesQuery.data?.candidates ?? [])
      .filter((c) => c.entity_type === "company" && c.review_kind !== "existing_needs_review")
      .map((c) => ({
        value: `candidate:${c.id}`,
        label: c.display_name,
        sublabel: `Suggested · ${Math.round((c.confidence ?? 0) * 100)}%`,
      }));

    return [...base, ...fromQuotes, ...suggested];
  }, [data, candidatesQuery.data, quotesQuery.data]);
}

export function useContactOptions(): SearchableOption[] {
  const { data = [] } = useContacts();
  return useMemo(
    () => data.map((c) => ({ value: c.id, label: c.name, sublabel: c.company ?? c.email ?? undefined })),
    [data],
  );
}

export function useTechnologyOptions(): SearchableOption[] {
  const { data = [] } = useTechnologies();
  return useMemo(() => data.map((t) => ({ value: t.id, label: t.name })), [data]);
}

export function useUserOptions(): SearchableOption[] {
  const { data = [] } = useProfiles();
  return useMemo(
    () => data.map((u) => ({ value: u.id, label: profileDisplayName(u), sublabel: u.email ?? undefined })),
    [data],
  );
}
