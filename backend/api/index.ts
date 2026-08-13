import app from "../src/app";
import { initializeDependencies } from "../src/api/dependencies";
import { initPool, initDatabase } from "../src/database";

let ready: Promise<void> | null = null;

function ensureReady(): Promise<void> {
    if (!ready) {
        ready = (async () => {
            initPool();
            await initDatabase();
            initializeDependencies();
        })();
    }
    return ready;
}

// Pre-initialize on module load (warm starts)
const warmup = ensureReady();

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