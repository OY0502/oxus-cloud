import type { ProfileRole } from "@/lib/types";

/** Routes only super_admin may access. */
export const SUPER_ADMIN_ONLY_ROUTES = [
  "/",
  "/pipeline",
  "/quotes",
  "/technologies",
  "/invoices",
  "/finance",
] as const;

/** Default landing route after login or access denial. */
export function getDefaultHomeRoute(role: string | null | undefined): string {
  return isSuperAdminRole(role) ? "/" : "/projects";
}

export function normalizeProfileRole(role: string | null | undefined): ProfileRole {
  if (role === "super_admin" || role === "admin") return "super_admin";
  return "pm";
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return normalizeProfileRole(role) === "super_admin";
}

export function isPmRole(role: string | null | undefined): boolean {
  return normalizeProfileRole(role) === "pm";
}

export function roleLabel(role: ProfileRole): string {
  return role === "super_admin" ? "Super admin" : "PM";
}

export function canAccessRoute(role: string | null | undefined, path: string): boolean {
  if (isSuperAdminRole(role)) return true;
  const normalized = path.split("?")[0] ?? path;
  if (normalized === "/" || normalized === "") return false;
  if (SUPER_ADMIN_ONLY_ROUTES.some((route) => {
    if (route === "/") return false;
    return normalized === route || normalized.startsWith(`${route}/`);
  })) {
    return false;
  }
  if (normalized.startsWith("/quotes")) return false;
  return true;
}

export function filterPagesForRole<T extends { href: string }>(pages: T[], role: string | null | undefined): T[] {
  if (isSuperAdminRole(role)) return pages;
  return pages.filter((page) => canAccessRoute(role, page.href));
}
