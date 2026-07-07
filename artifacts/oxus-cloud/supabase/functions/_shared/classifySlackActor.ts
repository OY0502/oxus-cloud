/** Classify Slack message authors as internal OXUS, client, external, or unknown. */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type SlackActorClassification = "internal" | "client" | "external" | "unknown";

export type ClassifiedSlackActor = {
  classification: SlackActorClassification;
  profile_id: string | null;
  contact_id: string | null;
  is_project_contact: boolean;
};

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().toLowerCase();
}

function normalizeName(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function namesStrongMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  if (aParts.length >= 2 && bParts.length >= 2) {
    return aParts[0] === bParts[0] && aParts[aParts.length - 1] === bParts[bParts.length - 1];
  }
  return false;
}

export async function classifySlackActor(args: {
  admin: SupabaseClient;
  projectId: string;
  slackUserName: string | null;
  slackUserEmail: string | null;
  linkType: string | null;
  isClientFacing: boolean;
}): Promise<ClassifiedSlackActor> {
  const email = normalizeEmail(args.slackUserEmail);
  const name = normalizeName(args.slackUserName);
  let profileId: string | null = null;
  let contactId: string | null = null;
  let isProjectContact = false;

  if (email) {
    const { data: profile } = await args.admin
      .from("profiles")
      .select("id, email, full_name")
      .ilike("email", email)
      .maybeSingle();
    if (profile?.id) {
      return {
        classification: "internal",
        profile_id: profile.id,
        contact_id: null,
        is_project_contact: false,
      };
    }
  }

  if (name) {
    const { data: profiles } = await args.admin
      .from("profiles")
      .select("id, email, full_name")
      .not("full_name", "is", null)
      .limit(200);
    for (const profile of profiles ?? []) {
      const profileName = normalizeName(profile.full_name);
      if (profileName && namesStrongMatch(name, profileName)) {
        return {
          classification: "internal",
          profile_id: profile.id,
          contact_id: null,
          is_project_contact: false,
        };
      }
    }
  }

  const { data: project } = await args.admin
    .from("projects")
    .select("id, client_id, point_of_contact_id")
    .eq("id", args.projectId)
    .maybeSingle();

  const contactIds = new Set<string>();
  if (project?.point_of_contact_id) contactIds.add(project.point_of_contact_id);
  if (project?.client_id) {
    const { data: clientContacts } = await args.admin
      .from("contacts")
      .select("id, email, full_name, client_id")
      .eq("client_id", project.client_id);
    for (const contact of clientContacts ?? []) {
      contactIds.add(contact.id);
      const contactEmail = normalizeEmail(contact.email);
      if (email && contactEmail && email === contactEmail) {
        return {
          classification: "client",
          profile_id: null,
          contact_id: contact.id,
          is_project_contact: project.point_of_contact_id === contact.id,
        };
      }
      const contactName = normalizeName(contact.full_name);
      if (name && contactName && namesStrongMatch(name, contactName)) {
        return {
          classification: "client",
          profile_id: null,
          contact_id: contact.id,
          is_project_contact: project.point_of_contact_id === contact.id,
        };
      }
    }
  }

  if (project?.point_of_contact_id && contactIds.has(project.point_of_contact_id)) {
    const { data: poc } = await args.admin
      .from("contacts")
      .select("id, email, full_name")
      .eq("id", project.point_of_contact_id)
      .maybeSingle();
    if (poc) {
      const pocEmail = normalizeEmail(poc.email);
      if (email && pocEmail && email === pocEmail) {
        return {
          classification: "client",
          profile_id: null,
          contact_id: poc.id,
          is_project_contact: true,
        };
      }
      const pocName = normalizeName(poc.full_name);
      if (name && pocName && namesStrongMatch(name, pocName)) {
        return {
          classification: "client",
          profile_id: null,
          contact_id: poc.id,
          is_project_contact: true,
        };
      }
    }
  }

  if (args.linkType === "external" || args.isClientFacing) {
    return {
      classification: "external",
      profile_id: null,
      contact_id: null,
      is_project_contact: false,
    };
  }

  return {
    classification: "unknown",
    profile_id: profileId,
    contact_id: contactId,
    is_project_contact: isProjectContact,
  };
}
