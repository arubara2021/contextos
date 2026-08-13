import { initPool, query } from "../../src/database";

export default async function handler(req: any, res: any) {
  try {
    const secret = process.env.CRON_SECRET ?? "";
    const auth = String(req.headers.authorization ?? "");
    if (secret && auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    initPool();
    const result = await query(
      `DELETE FROM users
WHERE is_sandbox = true
AND expires_at IS NOT NULL
AND expires_at <= now()`
    );
    res.status(200).json({ ok: true, deleted: result.rowCount ?? 0 });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
}