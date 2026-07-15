import Stripe from "npm:stripe@17.7.0";

const DEFAULT_API_VERSION = "2025-02-24.acacia";

export function getStripeApiVersion(): string {
  return Deno.env.get("STRIPE_API_VERSION")?.trim() || DEFAULT_API_VERSION;
}

export function getStripeSecretKey(): string | null {
  const key = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  return key || null;
}

export function getStripeWebhookSecret(): string | null {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim();
  return secret || null;
}

export function getStripeWebhookSecrets(): string[] {
  const secrets = [
    Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim(),
    Deno.env.get("STRIPE_WEBHOOK_SECRET_PREVIOUS")?.trim(),
  ].filter((value): value is string => !!value);
  return secrets;
}

export function createStripeClient(): Stripe | null {
  const secretKey = getStripeSecretKey();
  if (!secretKey) return null;
  return new Stripe(secretKey, {
    apiVersion: getStripeApiVersion() as Stripe.LatestApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function isStripeConfigured(): boolean {
  return !!getStripeSecretKey();
}

export type SafeStripeAccountInfo = {
  configured: boolean;
  account_id: string | null;
  business_name: string | null;
  country: string | null;
  default_currency: string | null;
  email: string | null;
};

export async function fetchSafeStripeAccountInfo(): Promise<SafeStripeAccountInfo> {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    return {
      configured: false,
      account_id: null,
      business_name: null,
      country: null,
      default_currency: null,
      email: null,
    };
  }

  const resp = await fetch("https://api.stripe.com/v1/account", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  if (!resp.ok) {
    throw new Error(`Stripe account lookup failed (${resp.status})`);
  }

  const account = await resp.json() as {
    id: string;
    email?: string;
    country?: string;
    default_currency?: string;
    business_profile?: { name?: string };
    settings?: { dashboard?: { display_name?: string } };
  };

  return {
    configured: true,
    account_id: account.id,
    business_name: account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? null,
    country: account.country ?? null,
    default_currency: account.default_currency ?? null,
    email: account.email ?? null,
  };
}

export function mapStripeInvoiceStatus(stripeStatus: string | null): string {
  switch (stripeStatus) {
    case "draft":
      return "draft";
    case "open":
      return "sent";
    case "paid":
      return "paid";
    case "uncollectible":
      return "uncollectible";
    case "void":
      return "void";
    default:
      return "sent";
  }
}

export function centsToAmount(cents: number | null | undefined): number {
  return (cents ?? 0) / 100;
}

export function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function isSafeExternalUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      (parsed.hostname.endsWith(".stripe.com") || parsed.hostname === "stripe.com");
  } catch {
    return false;
  }
}
