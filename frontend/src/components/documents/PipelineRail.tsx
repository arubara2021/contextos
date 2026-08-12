import { Icon } from "../shared/Icon";
import { ExtractionSummary } from "./ExtractionSummary";
import type { ProcessingJob, ProcessingStage } from "../../types";

interface PipelineRailProps {
  job: ProcessingJob;
  polling: boolean;
}

const STEPS: Array<{ key: string; label: string; hint: string }> = [
  { key: "parse", label: "Parse & normalize", hint: "text + metadata" },
  { key: "structure", label: "Structural analysis", hint: "sections · domain" },
  { key: "extract", label: "AI extraction", hint: "one call · concepts" },
  { key: "store", label: "Raw store", hint: "cockroach + s3" },
  { key: "embed", label: "Embeddings", hint: "1024-d vectors" },
  { key: "buckets", label: "Buckets & edges", hint: "merge · relate" },
  { key: "index", label: "Indexed", hint: "vector search live" },
];

const STEP_STRIDE = 44;

function stepFromProgress(progress: number): number {
  if (progress >= 97) return 6;
  if (progress >= 85) return 5;
  if (progress >= 70) return 4;
  if (progress >= 55) return 3;
  if (progress >= 35) return 2;
  if (progress >= 15) return 1;
  return 0;
}

function activeStepFor(job: ProcessingJob): number {
  if (job.status === "complete") return STEPS.length;
  const stageMap: Record<ProcessingStage, number> = {
    uploaded: 0,
    parsing: 1,
    classifying: 1,
    chunking: 2,
    embedding: 4,
    storing: 5,
    complete: STEPS.length,
    failed: stepFromProgress(job.progress),
  };
  return Math.max(stageMap[job.stage] ?? 0, stepFromProgress(job.progress));
}

export function PipelineRail({ job, polling }: PipelineRailProps) {
  const active = activeStepFor(job);
  const failed = job.status === "failed";
  const complete = job.status === "complete";
  const duplicate = job.status === "duplicate";

  const progressPx = Math.min(active, STEPS.length - 1) * STEP_STRIDE;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="truncate text-[13.5px] font-medium text-bone">{job.filename}</p>
        <span
          className={`t-mono flex-none text-[9px] uppercase tracking-[0.18em] ${failed
              ? "text-flare"
              : complete
                ? "text-moss"
                : duplicate
                  ? "text-stone"
                  : "text-mineral"
            }`}
        >
          {failed
            ? "failed"
            : complete
              ? "complete"
              : duplicate
                ? "deduplicated"
                : polling
                  ? `${job.progress}%`
                  : "queued"}
        </span>
      </div>

      <div className="relative flex-1">
        <div
          className="absolute left-[13px] top-3.5 w-px bg-line-strong"
          style={{ bottom: "14px" }}
        />
        {progressPx > 0 && (
          <div
            className="absolute left-[13px] top-3.5 w-px transition-all duration-700"
            style={{
              height: `${progressPx}px`,
              background: failed
                ? "var(--flare)"
                : "linear-gradient(180deg, var(--ember), var(--ember-hi))",
              opacity: failed ? 0.45 : 0.55,
            }}
          />
        )}

        <ol className="relative z-10">
          {STEPS.map((step, index) => {
            const done = index < active;
            const current = index === active && !complete && !duplicate;
            const isFailedStep = failed && index === active;
            const last = index === STEPS.length - 1;

            const markerClass = isFailedStep
              ? "border-flare bg-flare/10"
              : done
                ? "border-ember/60 bg-ember-faint"
                : current
                  ? "border-ember bg-ember-faint"
                  : "border-line-strong bg-coal";

            return (
              <li
                key={step.key}
                className={`relative flex gap-3.5 ${last ? "" : "pb-[16px]"}`}
              >
                <span
                  className={`relative z-10 flex h-7 w-7 flex-none items-center justify-center rounded-full border transition-all duration-500 ${markerClass} ${isFailedStep ? "fx-flicker" : ""
                    }`}
                >
                  {done ? (
                    <span className="text-ember-hi">
                      <Icon name="check" size={12} />
                    </span>
                  ) : isFailedStep ? (
                    <span className="h-2 w-2 rounded-full bg-flare shadow-[0_0_8px_rgba(255,92,73,0.6)]" />
                  ) : current ? (
                    <span className="fx-breathe h-2 w-2 rounded-full bg-ember shadow-ember" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-stone/30" />
                  )}
                </span>

                <div className="flex flex-1 items-baseline justify-between gap-3 pt-0.5">
                  <div>
                    <p
                      className={`text-[13px] transition-colors duration-300 ${done
                          ? "text-bone"
                          : current
                            ? "text-ember-hi"
                            : "text-stone/50"
                        }`}
                    >
                      {step.label}
                    </p>
                    <p className="t-mono text-[8.5px] uppercase tracking-[0.16em] text-stone/40">
                      {step.hint}
                    </p>
                  </div>
                  {done && (
                    <span className="t-mono text-[9px] uppercase tracking-[0.14em] text-moss">
                      done
                    </span>
                  )}
                  {current && !failed && (
                    <span className="t-mono text-[9px] text-mineral">
                      {job.progress}%
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {failed && job.error && (
        <div className="fx-rise mt-3 rounded-xl border border-flare/40 bg-flare/10 px-4 py-3 text-[12.5px] leading-relaxed text-flare">
          {job.error}
        </div>
      )}

      {duplicate && (
        <p className="t-mono mt-3 text-[9.5px] uppercase tracking-[0.2em] text-stone">
          Already in the archive — matched by content hash
        </p>
      )}

      {complete && <ExtractionSummary result={job.result} />}

      {polling && !complete && !failed && !duplicate && (
        <p className="t-mono mt-3 text-[9.5px] uppercase tracking-[0.2em] text-stone">
          {job.message}
          <span className="fx-blink ml-1.5 inline-block h-3 w-1.5 translate-y-0.5 bg-mineral" />
        </p>
      )}
    </div>
  );
}