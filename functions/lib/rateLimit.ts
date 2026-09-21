// Guards against one runaway browser session dominating container capacity
// (see CONTEXT.md: Export Job) — not adversarial-proof, just accidental-abuse
// protection, per the original design call.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

export async function checkExportRateLimit(
  db: D1Database,
  sessionToken: string,
): Promise<boolean> {
  const now = Date.now();
  const row = await db
    .prepare("SELECT window_start, count FROM export_rate_limits WHERE session_token = ?")
    .bind(sessionToken)
    .first<{ window_start: string; count: number }>();

  if (!row) {
    await db
      .prepare(
        "INSERT INTO export_rate_limits (session_token, window_start, count) VALUES (?, ?, 1)",
      )
      .bind(sessionToken, new Date(now).toISOString())
      .run();
    return true;
  }

  const windowStart = new Date(row.window_start).getTime();
  if (now - windowStart > WINDOW_MS) {
    await db
      .prepare(
        "UPDATE export_rate_limits SET window_start = ?, count = 1 WHERE session_token = ?",
      )
      .bind(new Date(now).toISOString(), sessionToken)
      .run();
    return true;
  }

  if (row.count >= MAX_PER_WINDOW) return false;

  await db
    .prepare("UPDATE export_rate_limits SET count = count + 1 WHERE session_token = ?")
    .bind(sessionToken)
    .run();
  return true;
}
