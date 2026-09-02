export type ProjectInvoicingTask = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  status_type: string | null;
  url: string | null;
  estimate_ms: number | null;
  tracked_ms: number;
};

export type ProjectInvoicingResponse = {
  linked: boolean;
  source: "live" | "cached";
  period: {
    key: string;
    label: string;
    start: string;
    end: string;
  };
  billing_tasks: ProjectInvoicingTask[];
  open_tasks: ProjectInvoicingTask[];
  warning: string | null;
};

export function previousMonthKey(now = new Date()): string {
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthBounds(monthKey: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) throw new Error("Invalid reporting month.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("Invalid reporting month.");
  return {
    start: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, month, 1)).toISOString(),
  };
}

export function formatMonthLabel(monthKey: string): string {
  const { start } = monthBounds(monthKey);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(start));
}

export function formatDuration(milliseconds: number | null): string {
  if (
    milliseconds == null ||
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0
  )
    return "—";
  const totalMinutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildInvoicingReport(args: {
  projectName: string;
  periodLabel: string;
  tasks: ProjectInvoicingTask[];
}): { text: string; html: string } {
  const totalTracked = args.tasks.reduce(
    (sum, task) => sum + task.tracked_ms,
    0,
  );
  const totalEstimate = args.tasks.reduce(
    (sum, task) => sum + (task.estimate_ms ?? 0),
    0,
  );
  const rows = args.tasks.map(
    (task) =>
      `• ${task.name}\n  Estimate: ${formatDuration(task.estimate_ms)} · Tracked: ${formatDuration(task.tracked_ms)}`,
  );
  const text = [
    `${args.projectName} — Invoicing report`,
    `Hours tracked in ${args.periodLabel}`,
    "",
    ...rows,
    "",
    `Total: ${formatDuration(totalTracked)} tracked · ${formatDuration(totalEstimate)} estimated`,
    "",
    "Let me know if you have any questions.",
  ].join("\n");

  const bodyRows = args.tasks
    .map(
      (task) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${escapeHtml(task.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${formatDuration(task.estimate_ms)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap"><strong>${formatDuration(task.tracked_ms)}</strong></td>
    </tr>`,
    )
    .join("");
  const html = `
    <div>
      <p><strong>${escapeHtml(args.projectName)} — Invoicing report</strong><br>Hours tracked in ${escapeHtml(args.periodLabel)}</p>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
        <thead><tr style="background:#f3f4f6;text-align:left"><th style="padding:8px 12px">Task</th><th style="padding:8px 12px">Estimate</th><th style="padding:8px 12px">Tracked</th></tr></thead>
        <tbody>${bodyRows}</tbody>
        <tfoot><tr><td style="padding:8px 12px"><strong>Total</strong></td><td style="padding:8px 12px"><strong>${formatDuration(totalEstimate)}</strong></td><td style="padding:8px 12px"><strong>${formatDuration(totalTracked)}</strong></td></tr></tfoot>
      </table>
      <p>Let me know if you have any questions.</p>
    </div>`;
  return { text, html };
}
