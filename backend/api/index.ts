import app from "../src/app";
import { initializeDependencies } from "../src/api/dependencies";
import { initDatabase } from "../src/database";

let initialized = false;
let initError: string | null = null;

async function ensureReady() {
    if (initialized) return;
    if (initError) throw new Error(initError);
    try {
        await initDatabase();
        initializeDependencies();
        initialized = true;
    } catch (error) {
        initError = (error as Error).message;
        throw error;
    }
}

export default async function handler(req: any, res: any) {
    try {
        await ensureReady();
        return app(req, res);
    } catch (error) {
        return res.status(503).json({
            error: "Database initialization failed",
            message: (error as Error).message,
            connectionSet: Boolean(process.env.COCKROACH_CONNECTION_STRING),
        });
    }
}