import { useMemo } from "react";
import { useClients, useContacts, useTechnologies, useProfiles } from "@/hooks/api";
import { profileDisplayName } from "@/lib/profiles";
import type { SearchableOption } from "@/components/forms/SearchableSelect";

export function useOrganizationOptions(): SearchableOption[] {
  const { data = [] } = useClients();
  return useMemo(
    () => data.map((c) => ({ value: c.id, label: c.name, sublabel: c.industry ?? c.website ?? undefined })),
    [data],
  );
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
