import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-oxus-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!(await isServiceRoleRequest(req))) return json({ error: "Service role required." }, 401);
  const body = await req.json().catch(() => ({})) as { audio_base64?: string; format?: string; language?: string };
  if (!body.audio_base64?.trim()) return json({ error: "audio_base64 is required." }, 400);
  if (body.audio_base64.length > 16_000_000) return json({ error: "Audio chunk exceeds the transcription request limit." }, 413);
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  const baseUrl = (Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  if (!apiKey) return json({ error: "OPENROUTER_API_KEY is required." }, 500);
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Title": "OXUS Cloud" },
    body: JSON.stringify({
      model: Deno.env.get("OPENROUTER_TRANSCRIPTION_MODEL")?.trim() || "openai/whisper-1",
      input_audio: { data: body.audio_base64, format: body.format?.trim() || "mp3" },
      ...(body.language?.trim() ? { language: body.language.trim() } : {}),
    }),
  });
  const responseText = await response.text();
  if (!response.ok) {
    console.error("[project-meeting-transcribe-chunk] provider error", { status: response.status, preview: responseText.slice(0, 300) });
    return json({ error: `Transcription provider failed (${response.status}).` }, 502);
  }
  const parsed = JSON.parse(responseText) as Record<string, unknown>;
  const transcript = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (!transcript) return json({ error: "Transcription provider returned no text." }, 502);
  return json({ text: transcript, usage: parsed.usage ?? null });
});
