import {
    initializeDependencies,
    getDependencies,
} from "../dependencies";

export default async function handler(req: any, res: any) {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        initializeDependencies();
        const { scanner } = getDependencies();
        await scanner.runReminderScan();
        return res.status(200).json({ ok: true, type: "reminders" });
    } catch (error) {
        return res.status(500).json({
            error: "Reminder dispatch failed",
            message: (error as Error).message,
        });
    }
}