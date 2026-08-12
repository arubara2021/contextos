import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { JOB_POLL_INTERVAL_MS } from "../constants";
import type { ProcessingJob, ProcessingJobStatus } from "../types";

const TERMINAL_STATUSES: ReadonlySet<ProcessingJobStatus> = new Set([
  "complete",
  "failed",
  "duplicate",
]);

export function useJobPolling(
  jobId: string | null,
  onComplete?: (job: ProcessingJob) => void
) {
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setPolling(false);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    setPolling(true);
    setError(null);

    const tick = async () => {
      try {
        const current = await api.documents.job(jobId);
        if (cancelled) return;
        setJob(current);
        if (TERMINAL_STATUSES.has(current.status)) {
          setPolling(false);
          completeRef.current?.(current);
          return;
        }
        timer = window.setTimeout(tick, JOB_POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Polling failed");
        setPolling(false);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobId]);

  return {
    job,
    polling,
    error,
    isComplete: job !== null && TERMINAL_STATUSES.has(job.status),
  };
}