export type ManualInvoiceLineInput = { description: string; quantity: string; unit_amount: string };

export function parseManualInvoiceLines(lines: ManualInvoiceLineInput[]) {
  if (!lines.length) throw new Error("Add at least one line item.");
  return lines.map((line, index) => {
    const description = line.description.trim();
    const quantity = Number(line.quantity);
    const unit_amount = Number(line.unit_amount);
    if (!description || !Number.isFinite(quantity) || quantity <= 0
      || !line.unit_amount.trim() || !Number.isFinite(unit_amount) || unit_amount <= 0
      || Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001
      || Math.abs(unit_amount * 100 - Math.round(unit_amount * 100)) > 0.000001) {
      throw new Error(`Line ${index + 1}: enter a description, a positive quantity and unit amount with at most two decimal places.`);
    }
    return { description, quantity, unit_amount };
  });
}

export function manualInvoiceTotal(lines: { quantity: number; unit_amount: number }[]) {
  return lines.reduce((sum, line) => sum
    + Math.round(Math.round(line.quantity * 100) * Math.round(line.unit_amount * 100) / 100), 0) / 100;
}

export type ManualInvoiceInput = {
  id: string;
  number?: string;
  company_id: string;
  project_id?: string;
  currency: string;
  issue_date: string;
  due_date?: string;
  memo?: string;
  line_items: ReturnType<typeof parseManualInvoiceLines>;
};
