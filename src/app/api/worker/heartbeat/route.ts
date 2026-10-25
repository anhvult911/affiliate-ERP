import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

const heartbeatSchema = z.object({
  worker: z.string().trim().min(1, "Identify the worker.").max(64),
  host: z.string().trim().max(128).optional(),
  mode: z.string().trim().max(64).optional()
});

/**
 * POST /api/worker/heartbeat
 *
 * The worker pings on a timer independent of the claim loop, so a task that takes
 * 90 seconds does not look like a dead process. `/api/cron/health` turns a stale
 * heartbeat into an alert.
 *
 * A fresh heartbeat also clears `alerted_at`: when the worker comes back, the next
 * death must alert immediately instead of waiting out the throttle.
 */
export async function POST(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return workerJson({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body." }, 400);
  }

  const { worker, host, mode } = parsed.data;
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.from("worker_heartbeats").upsert(
    {
      worker,
      host: host ?? null,
      mode: mode ?? null,
      last_seen_at: new Date().toISOString(),
      alerted_at: null
    },
    { onConflict: "worker" }
  );

  if (error) return workerJson({ ok: false, error: error.message }, 500);

  return workerJson({ ok: true });
}
