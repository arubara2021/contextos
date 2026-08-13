import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_pgreganubcxrzchvibkq",
  runtime: "node",
  logLevel: "log",
  maxDuration: 300, // 5 minutes — way more than enough
  retries: {
    enabledInDev: true,
    enabledInProd: true,
  },
  dirs: ["./src/tasks"],
});