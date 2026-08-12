import app from "../src/app";
import { initializeDependencies } from "../src/api/dependencies";
import { initDatabase } from "../src/database";

await initDatabase();
initializeDependencies();

export default app;