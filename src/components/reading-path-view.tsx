import Link from "next/link";

import { Cover } from "./cover";
import type { RankedRecommendation, ReadingPathResult } from "@/lib/reading-path/types";

export function ReadingPathView({ result }: { result: ReadingPathResult }) {
  const [start, ...remaining] = result.recommendations;
  const title = result.query.storyArc
    ? result.query.storyArc.name
    : result.query.characters.map(({ name }) => name).join(" + ");

  if (!start) {
    return (
      <section className="empty-state">
        <p className="section-kicker">No shared route yet</p>
        <h1>{title}</h1>
        <p>
          These topics are in the catalog, but the current dataset has no matching issues.
          Try one character at a time.
        </p>
        <Link className="primary-button" href="/">
          Try another search
        </Link>
      </section>
    );
  }

  const branches = branchCandidates(remaining);

  return (
    <main className="reading-page">
      <header className="reading-intro">
        <p className="section-kicker">Your reading path</p>
        <h1>{title}</h1>
        <p>
          Start with one clear option. Then choose the direction that matches how far you
          want to go.
        </p>
      </header>

      <section className="start-section" aria-labelledby="start-heading">
        <div className="section-heading">
          <p className="section-kicker">The strongest entry point</p>
          <h2 id="start-heading">Start here</h2>
        </div>
        <FeaturedRecommendation recommendation={start} />
      </section>

      {branches.length > 0 && (
        <section className="branches" aria-labelledby="branches-heading">
          <div className="section-heading plain-heading">
            <h2 id="branches-heading">Where do you want to go next?</h2>
            <p>Each branch stays grounded in the same issue and character data.</p>
          </div>
          {branches.map((branch) => (
            <details
              className="branch"
              key={branch.label}
              name="reading-branches"
              open={branch.label === "Short route"}
            >
              <summary>
                <span>{branch.label}</span>
                <small>{branch.description}</small>
              </summary>
              <ol className="path-row">
                {branch.items.map((candidate) => (
                  <li key={candidate.id}>
                    <CandidateNode candidate={candidate} />
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </section>
      )}
    </main>
  );
}

function FeaturedRecommendation({
  recommendation,
}: {
  recommendation: RankedRecommendation;
}) {
  const first = recommendation.issues[0];
  return (
    <article className="featured-recommendation">
      <Cover
        imageUrl={first.imageUrl}
        alt={`${first.volume.name} issue ${first.issueNumber} cover`}
        priority
      />
      <div className="featured-copy">
        <p className="recommendation-score">Recommendation score {recommendation.score}</p>
        <h3>{recommendation.title}</h3>
        <p className="issue-meta">{candidateMeta(recommendation)}</p>
        <ul className="reason-list">
          {recommendation.reasons.slice(0, 3).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <details className="recommendation-detail">
          <summary>View issues and reasoning</summary>
          <IssueList recommendation={recommendation} />
        </details>
      </div>
    </article>
  );
}

function CandidateNode({ candidate }: { candidate: RankedRecommendation }) {
  const first = candidate.issues[0];
  return (
    <article className="candidate-node">
      <Cover
        imageUrl={first.imageUrl}
        alt={`${first.volume.name} issue ${first.issueNumber} cover`}
      />
      <div>
        <h3>{candidate.title}</h3>
        <p>{candidateMeta(candidate)}</p>
        <details className="recommendation-detail">
          <summary>Why this path?</summary>
          <ul className="reason-list">
            {candidate.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <IssueList recommendation={candidate} />
        </details>
      </div>
    </article>
  );
}

function IssueList({ recommendation }: { recommendation: RankedRecommendation }) {
  return (
    <ol className="issue-list">
      {recommendation.issues.map((issue) => (
        <li key={issue.id}>
          <span>
            {issue.volume.name} #{issue.issueNumber}
          </span>
          <time dateTime={issue.coverDate ?? undefined}>{issue.coverDate ?? "Date unavailable"}</time>
        </li>
      ))}
    </ol>
  );
}

function candidateMeta(candidate: RankedRecommendation): string {
  const first = candidate.issues[0];
  const year = first.coverDate?.slice(0, 4) ?? first.volume.startYear;
  return `${candidate.issues.length} issue${candidate.issues.length === 1 ? "" : "s"}${year ? ` · ${year}` : ""}`;
}

function branchCandidates(candidates: RankedRecommendation[]) {
  const branches = [
    {
      label: "Short route",
      description: "A smaller commitment",
      items: [] as RankedRecommendation[],
    },
    {
      label: "Modern",
      description: "Published from 2000 onward",
      items: [] as RankedRecommendation[],
    },
    {
      label: "The classics",
      description: "Earlier publication history",
      items: [] as RankedRecommendation[],
    },
  ];

  for (const candidate of candidates) {
    const year = Number(candidate.issues[0].coverDate?.slice(0, 4) ?? 0);
    const branch =
      candidate.issues.length <= 3 && branches[0].items.length < 3
        ? branches[0]
        : year >= 2000
          ? branches[1]
          : branches[2];
    if (branch.items.length < 3) branch.items.push(candidate);
  }
  return branches.filter(({ items }) => items.length > 0);
}
