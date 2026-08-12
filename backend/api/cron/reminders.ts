import { initializeDependencies, getDependencies } from "../../src/api/dependencies";
export default async function handler(req: any, res: any) {
  try {
    initializeDependencies();
    const { scanner } = getDependencies();
    await scanner.runReminderScan();
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
}