import app from "../src/app";
import { initializeDependencies } from "../src/api/dependencies";
import { initDatabase } from "../src/database";

let initialized = false;

async function ensureReady() {
  if (initialized) return;
  await initDatabase();
  initializeDependencies();
  initialized = true;
}

export default async function handler(req: any, res: any) {
  await ensureReady();
  return app(req, res);
}