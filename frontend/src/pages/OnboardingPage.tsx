import { Link } from "react-router-dom";
import { useAuthContext } from "../auth/AuthProvider";
import { useStats } from "../hooks/useStats";
import { ROUTES } from "../constants";

const STEPS = [
  {
    number: "01",
    title: "Feed the archive",
    body: "Drop in a paper, notes, code, a book. One extraction pass turns it into living concepts — no re-reading, ever.",
    action: "Open the archive",
    to: ROUTES.archive,
  },
  {
    number: "02",
    title: "Ask a question",
    body: "Start a dive. Relevant memories ignite, join the conversation, and get stronger every time they're used.",
    action: "Start a dive",
    to: ROUTES.dive,
  },
  {
    number: "03",
    title: "Watch it live",
    body: "Every memory is a node. Strong ones glow, unused ones fade — and the graph will tell you before something slips away.",
    action: "Enter the cortex",
    to: ROUTES.cortex,
  },
];

export function OnboardingPage() {
  const { user } = useAuthContext();
  const { stats } = useStats(false);
  const alive = (stats?.totalBuckets ?? 0) > 0;
  const firstName = (user?.displayName ?? "friend").split(" ")[0];

  return (
    <div className="page">
      <div className="page-narrow max-w-3xl">
        <header className="page-head">
          <p className="kicker">Ignition sequence</p>
          <h1 className="page-title">
            Welcome, <em>{firstName}.</em>
          </h1>
          <p className="page-sub">
            Three moves and your second brain is breathing. Extraction happens once —{" "}
            <b>retrieval happens forever.</b>
          </p>
        </header>

        <ol className="relative flex flex-col gap-10 pl-2">
          <span
            className="absolute bottom-6 left-[27px] top-6 w-px"
            style={{
              background:
                "linear-gradient(180deg, rgba(255, 138, 61, 0.5), rgba(255, 138, 61, 0.08))",
            }}
          />
          {STEPS.map((step, index) => (
            <li
              key={step.number}
              className="fx-rise relative flex gap-7"
              style={{ "--rise-delay": `${0.1 + index * 0.12}s` } as React.CSSProperties}
            >
              <span className="relative z-10 flex h-12 w-12 flex-none items-center justify-center rounded-2xl border border-ember/40 bg-coal font-display text-lg font-medium text-ember-hi shadow-ember">
                {step.number}
              </span>
              <div className="flex flex-1 flex-col items-start gap-3 pt-1">
                <h2 className="font-display text-2xl font-medium text-bone">{step.title}</h2>
                <p className="max-w-md text-[14.5px] font-light leading-relaxed text-stone">
                  {step.body}
                </p>
                <Link to={step.to} className="btn btn-ghost btn-sm">
                  {step.action}
                </Link>
              </div>
            </li>
          ))}
        </ol>

        {alive && stats && (
          <div className="fx-rise panel mt-12 flex flex-wrap items-center gap-5 px-6 py-5" style={{ "--rise-delay": "0.5s" } as React.CSSProperties}>
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-ember shadow-ember" />
            </span>
            <p className="flex-1 text-[14px] font-light text-bone">
              Your graph is already alive —{" "}
              <b className="font-medium text-ember-hi">{stats.totalBuckets} memories</b>,{" "}
              {stats.strongCount} strong, {stats.totalRelationships} connections.
            </p>
            <Link to={ROUTES.cortex} className="btn btn-primary btn-sm">
              See it breathe
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}