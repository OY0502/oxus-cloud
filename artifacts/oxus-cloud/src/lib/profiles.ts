import type { Profile } from "@/lib/types";

export function profileDisplayName(p: Profile): string {
  return p.full_name?.trim() || p.email?.split("@")[0] || "User";
}

export function profileAvatarUrl(p: Profile): string {
  return (
    p.avatar_url ??
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profileDisplayName(p))}&background=random`
  );
}
