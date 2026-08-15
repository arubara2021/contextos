import logger from "../utils/logger";

const GITHUB_TOKEN = (process.env.GITHUB_DISPATCH_TOKEN ?? "").trim();
const GITHUB_REPO = process.env.GITHUB_REPO ?? "arubara2021/contextos";
const GITHUB_WORKFLOW = process.env.GITHUB_WORKFLOW_FILE ?? "worker.yml";

let lastDispatch = 0;
const MIN_INTERVAL_MS = 10_000;

export async function triggerGitHubWorker(): Promise<boolean> {
  if (!GITHUB_TOKEN) return false;
  const now = Date.now();
  if (now - lastDispatch < MIN_INTERVAL_MS) return false;
  lastDispatch = now;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );
    if (res.status === 204) {
      logger.info("GitHub worker dispatched", { repo: GITHUB_REPO });
      return true;
    }
    logger.warn("GitHub worker dispatch failed", { status: res.status });
    return false;
  } catch (error) {
    logger.warn("GitHub worker dispatch error", {
      error: (error as Error).message,
    });
    return false;
  }
}