import app from "../src/app";
import { initializeDependencies } from "../src/api/dependencies";
import { initPool, initDatabase } from "../src/database";

export const config = {
    maxDuration: 60,
};

let ready: Promise<void> | null = null;

function ensureReady(): Promise<void> {
    if (!ready) {
        ready = (async () => {
            initPool();
            // Skip heavy schema migrations on Vercel cold starts to prevent 5-10s timeout/lag.
            // Run `npm run init-db` manually locally for schema updates.
            if (!process.env.VERCEL) {
                await initDatabase();
            }
            initializeDependencies();
        })();
    }
    return ready;
}

void ensureReady();

export default async function handler(req: any, res: any) {
    try {
        await ensureReady();
        return app(req, res);
    } catch (error) {
        return res.status(503).json({
            error: "Service unavailable",
            message: (error as Error).message,
        });
    }
}