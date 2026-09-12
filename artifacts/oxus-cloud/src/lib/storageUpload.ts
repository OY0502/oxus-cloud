export function supabaseResumableUploadEndpoint(projectUrl: string): string {
  const endpoint = new URL(projectUrl);
  if (endpoint.hostname.endsWith(".supabase.co") && !endpoint.hostname.endsWith(".storage.supabase.co")) {
    endpoint.hostname = endpoint.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  endpoint.pathname = "/storage/v1/upload/resumable";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

export function isCompactJwt(token: string): boolean {
  return token.split(".").length === 3;
}
