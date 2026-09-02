import { createClient } from "npm:@supabase/supabase-js@2";
import { clickupFetch } from "../_shared/clickup.ts";
import {
  ClickupAuthError,
  clickupAuthErrorResponse,
  resolveUserClickupForProject,
} from "../_shared/clickup-auth.ts";
import {
  assertInternalOxusAuthUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status: number, code: string, details?: string) {
  return json({ error: message, details, code }, status);
}

function anonKey(): string | null {
  const key = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (key) return key;
  try {
    const keys = JSON.parse(
      Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}",
    ) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? null;
  } catch {
    return null;
  }
}

function getMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("month must use YYYY-MM format.");
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12)
    throw new Error("month must use YYYY-MM format.");
  const start = Date.UTC(year, monthNumber - 1, 1);
  const end = Date.UTC(year, monthNumber, 1);
  const label = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(start));
  return { key: month, label, start, end };
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function taskStatus(task: Record<string, unknown>): {
  name: string;
  type: string | null;
} {
  const status =
    task.status &&
    typeof task.status === "object" &&
    !Array.isArray(task.status)
      ? (task.status as Record<string, unknown>)
      : {};
  return {
    name: String(status.status ?? "Unknown"),
    type: typeof status.type === "string" ? status.type : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer "))
      return err("Authentication required.", 401, "AUTH_REQUIRED");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const key = anonKey();
    if (!supabaseUrl || !key)
      return err("Missing Supabase environment.", 500, "CONFIG_ERROR");

    const body = (await req.json().catch(() => null)) as {
      project_id?: string;
      month?: string;
    } | null;
    if (!body?.project_id)
      return err("project_id is required.", 400, "INVALID_INPUT");
    const now = new Date();
    const previousMonth =
      now.getUTCMonth() === 0
        ? `${now.getUTCFullYear() - 1}-12`
        : `${now.getUTCFullYear()}-${String(now.getUTCMonth()).padStart(2, "0")}`;
    let period;
    try {
      period = getMonth(body.month ?? previousMonth);
    } catch (error) {
      return err((error as Error).message, 400, "INVALID_INPUT");
    }

    const supabase = createClient(supabaseUrl, key, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const token = authHeader.slice("Bearer ".length);
    const { data: auth } = await supabase.auth.getUser(token);
    let userId: string;
    try {
      userId = await assertInternalOxusAuthUser(auth.user);
    } catch (error) {
      if (error instanceof InternalOxusAuthError)
        return internalOxusAuthErrorResponse(error, corsHeaders);
      throw error;
    }

    const { data: link, error: linkError } = await supabase
      .from("project_clickup_links")
      .select("clickup_list_id, clickup_space_id")
      .eq("project_id", body.project_id)
      .eq("status", "active")
      .maybeSingle();
    if (linkError)
      return err(
        "Could not read the project ClickUp connection.",
        500,
        "DB_ERROR",
        linkError.message,
      );
    if (!link?.clickup_list_id && !link?.clickup_space_id) {
      return json({
        linked: false,
        source: "live",
        period: {
          key: period.key,
          label: period.label,
          start: new Date(period.start).toISOString(),
          end: new Date(period.end).toISOString(),
        },
        billing_tasks: [],
        open_tasks: [],
        warning: null,
      });
    }

    let clickup;
    try {
      ({ clickup } = await resolveUserClickupForProject(
        userId,
        body.project_id,
      ));
    } catch (error) {
      if (error instanceof ClickupAuthError)
        return clickupAuthErrorResponse(error, corsHeaders);
      throw error;
    }

    const listId = link.clickup_list_id ? String(link.clickup_list_id) : null;
    const spaceId = link.clickup_space_id
      ? String(link.clickup_space_id)
      : null;
    const rawTasks: Record<string, unknown>[] = [];
    for (let page = 0; page < 10 && rawTasks.length < 1000; page += 1) {
      const taskPath = spaceId
        ? `/team/${encodeURIComponent(clickup.teamId)}/task?space_ids%5B%5D=${encodeURIComponent(spaceId)}&include_closed=true&subtasks=true&order_by=updated&page=${page}`
        : `/list/${encodeURIComponent(listId!)}/task?archived=false&include_closed=true&subtasks=true&include_markdown_description=true&order_by=updated&page=${page}`;
      const response = (await clickupFetch(clickup, taskPath)) as {
        tasks?: Record<string, unknown>[];
        last_page?: boolean;
      };
      const pageTasks = Array.isArray(response.tasks) ? response.tasks : [];
      rawTasks.push(...pageTasks);
      if (response.last_page === true || pageTasks.length < 100) break;
    }

    let trackedByTask = new Map<string, number>();
    let warning: string | null = null;
    try {
      const membersResponse = listId
        ? ((await clickupFetch(
            clickup,
            `/list/${encodeURIComponent(listId)}/member`,
          )) as {
            members?: Array<{ id?: string | number }>;
          })
        : { members: [] };
      const taskAssigneeIds = rawTasks.flatMap((task) =>
        Array.isArray(task.assignees)
          ? task.assignees.map((assignee) => {
              const row =
                assignee &&
                typeof assignee === "object" &&
                !Array.isArray(assignee)
                  ? (assignee as Record<string, unknown>)
                  : {};
              return row.id ?? row.userid;
            })
          : [],
      );
      const assigneeIds = [
        ...new Set(
          [
            ...(membersResponse.members ?? []).map((member) => member.id),
            ...taskAssigneeIds,
          ]
            .filter(Boolean)
            .map(String),
        ),
      ];
      const params = new URLSearchParams({
        start_date: String(period.start),
        end_date: String(period.end - 1),
      });
      if (spaceId) params.set("space_id", spaceId);
      else if (listId) params.set("list_id", listId);
      if (assigneeIds.length > 0) params.set("assignee", assigneeIds.join(","));
      const timeResponse = (await clickupFetch(
        clickup,
        `/team/${encodeURIComponent(clickup.teamId)}/time_entries?${params.toString()}`,
      )) as { data?: Record<string, unknown>[] };
      trackedByTask = new Map<string, number>();
      for (const entry of timeResponse.data ?? []) {
        const task =
          entry.task &&
          typeof entry.task === "object" &&
          !Array.isArray(entry.task)
            ? (entry.task as Record<string, unknown>)
            : {};
        const taskId = String(task.id ?? entry.task_id ?? entry.tid ?? "");
        const duration = Number(entry.duration);
        if (!taskId || !Number.isFinite(duration) || duration <= 0) continue;
        trackedByTask.set(taskId, (trackedByTask.get(taskId) ?? 0) + duration);
      }
    } catch (error) {
      warning =
        "Monthly time entries could not be loaded, so tracked time shows each task's current ClickUp total.";
      trackedByTask = new Map(
        rawTasks.map((task) => [
          String(task.id ?? ""),
          numberOrNull(task.time_spent) ?? 0,
        ]),
      );
      console.warn(
        "[clickup-project-invoicing] time entry lookup failed",
        (error as Error).message,
      );
    }

    const tasks = rawTasks
      .map((task) => {
        const status = taskStatus(task);
        return {
          id: String(task.id ?? ""),
          name: String(task.name ?? task.id ?? "Untitled task"),
          description:
            String(
              task.markdown_description ??
                task.text_content ??
                task.description ??
                "",
            ).trim() || null,
          status: status.name,
          status_type: status.type,
          url: task.url ? String(task.url) : null,
          estimate_ms: numberOrNull(task.time_estimate),
          tracked_ms: trackedByTask.get(String(task.id ?? "")) ?? 0,
        };
      })
      .filter((task) => task.id);
    const billing = tasks
      .filter((task) => task.status.trim().toLowerCase() === "billing")
      .sort(
        (a, b) => b.tracked_ms - a.tracked_ms || a.name.localeCompare(b.name),
      );
    const open = tasks
      .filter((task) => task.status.trim().toLowerCase() !== "billing")
      .filter((task) => task.status_type?.toLowerCase() !== "closed")
      .filter(
        (task) =>
          !/^(closed|complete|completed|done)$/i.test(task.status.trim()),
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    return json({
      linked: true,
      source: "live",
      period: {
        key: period.key,
        label: period.label,
        start: new Date(period.start).toISOString(),
        end: new Date(period.end).toISOString(),
      },
      billing_tasks: billing,
      open_tasks: open,
      warning,
    });
  } catch (error) {
    console.error("[clickup-project-invoicing]", (error as Error).message);
    return err(
      "Failed to load ClickUp invoicing tasks.",
      502,
      "CLICKUP_ERROR",
      (error as Error).message,
    );
  }
});
