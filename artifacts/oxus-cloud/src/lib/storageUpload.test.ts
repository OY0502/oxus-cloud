import { describe, expect, it } from "vitest";
import { isCompactJwt, supabaseResumableUploadEndpoint } from "./storageUpload";

describe("project intake storage uploads", () => {
  it("uses Supabase's direct Storage hostname for resumable uploads", () => {
    expect(supabaseResumableUploadEndpoint("https://example.supabase.co")).toBe(
      "https://example.storage.supabase.co/storage/v1/upload/resumable",
    );
  });

  it("uses Supabase's signed resumable endpoint when requested", () => {
    expect(supabaseResumableUploadEndpoint("https://example.supabase.co", true)).toBe(
      "https://example.storage.supabase.co/storage/v1/upload/resumable/sign",
    );
  });

  it("preserves a custom host while replacing its upload path", () => {
    expect(supabaseResumableUploadEndpoint("https://storage.example.com/api?old=true")).toBe(
      "https://storage.example.com/storage/v1/upload/resumable",
    );
  });

  it("distinguishes user JWTs from opaque publishable keys", () => {
    expect(isCompactJwt("header.payload.signature")).toBe(true);
    expect(isCompactJwt("sb_publishable_example")).toBe(false);
  });
});
