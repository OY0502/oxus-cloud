export type WiseProbeSource = "balance_statement" | "transfer";

export interface WiseProbeMatch {
  source: WiseProbeSource;
  external_id: string;
  amount: number;
  currency: string;
  date: string | null;
  direction: "credit" | "debit" | "unknown";
  counterparty: string | null;
  reference: string | null;
  description: string | null;
  status: string | null;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = asString(value);
    if (candidate) return candidate;
  }
  return null;
}

function amountMatches(actual: number | null, expected: number): boolean {
  return actual != null && Math.abs(Math.abs(actual) - Math.abs(expected)) < 0.005;
}

function includesQuery(values: Array<string | null>, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLocaleLowerCase().includes(needle));
}

export function findStatementMatches(
  transactions: unknown[],
  amount: number,
  counterpartyQuery: string,
): WiseProbeMatch[] {
  return transactions.flatMap((entry, index) => {
    const transaction = asRecord(entry);
    const amountObject = asRecord(transaction.amount);
    const details = asRecord(transaction.details);
    const sender = asRecord(details.sender);
    const recipient = asRecord(details.recipient);
    const actualAmount = asNumber(amountObject.value ?? transaction.amount);
    if (!amountMatches(actualAmount, amount)) return [];

    const counterparty = firstString(
      details.senderName,
      details.recipientName,
      details.counterpartyName,
      sender.name,
      recipient.name,
      transaction.counterpartyName,
    );
    const reference = firstString(
      transaction.referenceNumber,
      details.reference,
      details.paymentReference,
    );
    const description = firstString(details.description, transaction.description);
    if (!includesQuery([counterparty, reference, description], counterpartyQuery)) return [];

    const type = (asString(transaction.type) ?? "").toLocaleUpperCase();
    return [{
      source: "balance_statement" as const,
      external_id: firstString(transaction.id, transaction.referenceNumber) ?? `statement-${index}`,
      amount: Math.abs(actualAmount!),
      currency: firstString(amountObject.currency, transaction.currency) ?? "EUR",
      date: firstString(transaction.date, transaction.createdAt, transaction.created_at),
      direction: type === "CREDIT" ? "credit" as const : type === "DEBIT" ? "debit" as const : "unknown" as const,
      counterparty,
      reference,
      description,
      status: firstString(transaction.status),
    }];
  });
}

export function findTransferMatches(
  transfers: unknown[],
  amount: number,
  counterpartyQuery: string,
): WiseProbeMatch[] {
  return transfers.flatMap((entry) => {
    const transfer = asRecord(entry);
    const details = asRecord(transfer.details);
    const sourceValue = asNumber(transfer.sourceValue);
    const targetValue = asNumber(transfer.targetValue);
    const matchedValue = amountMatches(sourceValue, amount)
      ? sourceValue
      : amountMatches(targetValue, amount)
        ? targetValue
        : null;
    if (matchedValue == null) return [];

    const counterparty = firstString(
      transfer.recipientName,
      transfer.accountHolderName,
      details.recipientName,
    );
    const reference = firstString(details.reference, transfer.reference);
    const description = firstString(transfer.status, details.transferPurpose);
    if (!includesQuery([counterparty, reference, description], counterpartyQuery)) return [];

    return [{
      source: "transfer" as const,
      external_id: String(transfer.id ?? transfer.customerTransactionId ?? "unknown"),
      amount: Math.abs(matchedValue),
      currency: amountMatches(sourceValue, amount)
        ? firstString(transfer.sourceCurrency) ?? "EUR"
        : firstString(transfer.targetCurrency) ?? "EUR",
      date: firstString(transfer.created, transfer.createdAt, transfer.created_at),
      // The transfers API describes the payment order, not whether the linked
      // Wise balance activity appears as a credit or debit. Only a balance
      // statement can establish that direction reliably.
      direction: "unknown" as const,
      counterparty,
      reference,
      description,
      status: firstString(transfer.status),
    }];
  });
}
