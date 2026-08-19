import Link from "next/link";

import { Cover } from "./cover";
import type { RankedRecommendation, ReadingPathResult } from "@/lib/reading-path/types";

/** Long runs list their opening issues rather than forty rows of metadata. */
const VISIBLE_ISSUES = 8;

export function ReadingPathView({ result }: { result: ReadingPathResult }) {
  const [start, ...remaining] = result.recommendations;
  const title = result.query.storyArc
    ? result.query.storyArc.name
    : result.query.characters.map(({ name }) => name).join(" + ");
  // Asking about one character is a different question from asking about two, and
  // the page has to sound like it knows which was asked. Plural copy on a solo
  // page reads as though the answer came from comparing them to somebody else.
  const solo = !result.query.storyArc && result.query.characters.length === 1
    ? result.query.characters[0].name
    : null;

  if (!start) {
    return (
      <section className="empty-state">
        <p className="section-kicker">No shared route yet</p>
        <h1>{title}</h1>
        <p>
          {solo
            ? `I found ${solo}, but nothing solid enough to point you at yet. Try another name they go by, or a story arc instead.`
            : "I found those characters, but not a clean shared reading route yet. Try one character at a time, or pair characters who meet in the same books."}
        </p>
        <Link className="primary-button" href="/">
          Try another search
        </Link>
      </section>
    );
  }

  // Saying so is more useful than dressing a passing appearance up as a starting
  // point, which is exactly what this engine was rebuilt to stop doing.
  if (!start.eligibleAsStart) {
    return (
      <main className="reading-page">
        <header className="reading-intro">
          <p className="section-kicker">{solo ? "Nothing central yet" : "No shared story yet"}</p>
          <h1>{title}</h1>
          <p>
            {solo
              ? `${solo} turns up in these books, but none of them is really about ${solo}. Here is everything I found, so you can judge for yourself.`
              : "These characters cross paths, but I could not find a book that is really about them together. Here is everything they do share, so you can judge for yourself."}
          </p>
        </header>

        <section className="branches" aria-labelledby="thin-heading">
          <div className="section-heading plain-heading">
            <h2 id="thin-heading">{solo ? "Where they turn up" : "Where they overlap"}</h2>
          </div>
          <ol className="path-row">
            {result.recommendations.slice(0, 6).map((candidate) => (
              <li key={candidate.id}>
                <CandidateNode candidate={candidate} />
              </li>
            ))}
          </ol>
        </section>
      </main>
    );
  }

  const branches = branchCandidates(remaining);

  return (
    <main className="reading-page">
      <header className="reading-intro">
        <p className="section-kicker">Your reading path</p>
        <h1>{title}</h1>
        <p>
          {solo
            ? `Start with the book that is most about ${solo}, then choose how much further you want to go.`
            : "Start with the book these characters actually share, then choose how much further you want to go."}
        </p>
      </header>

      <section className="start-section" aria-labelledby="start-heading">
        <div className="section-heading">
          <p className="section-kicker">Best first pick</p>
          <h2 id="start-heading">Start here</h2>
        </div>
        <FeaturedRecommendation recommendation={start} />
      </section>

      {branches.length > 0 && (
        <section className="branches" aria-labelledby="branches-heading">
          <div className="section-heading plain-heading">
            <h2 id="branches-heading">Where do you want to go next?</h2>
            <p>Pick a next step based on how much you want to read.</p>
          </div>
          {branches.map((branch) => (
            <details
              className="branch"
              key={branch.label}
              name="reading-branches"
              open={branch.label === branches[0].label}
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
        <ScoreSummary recommendation={recommendation} />
        <h3>{recommendation.title}</h3>
        <p className="issue-meta">{candidateMeta(recommendation)}</p>
        <CreatorLine recommendation={recommendation} />
        <ul className="reason-list">
          {recommendation.reasons.slice(0, 4).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <details className="recommendation-detail">
          <summary>Show the exact issues</summary>
          <IssueList recommendation={recommendation} />
        </details>
      </div>
    </article>
  );
}

/**
 * Two named numbers instead of one opaque percentage. A reader deciding what to
 * buy needs to know which of the two questions a book actually answers.
 */
function ScoreSummary({ recommendation }: { recommendation: RankedRecommendation }) {
  return (
    <p className="recommendation-score">
      <span>Together {percent(recommendation.features.togetherness)}</span>
      {" · "}
      <span>Beginner-friendly {percent(recommendation.features.beginnerFriendliness)}</span>
      {recommendation.features.acclaim > 0.35 && (
        <>
          {" · "}
          <span>Acclaim {percent(recommendation.features.acclaim)}</span>
        </>
      )}
    </p>
  );
}

function CreatorLine({ recommendation }: { recommendation: RankedRecommendation }) {
  if (!recommendation.creators.length) return null;
  return (
    <p className="issue-meta">
      {recommendation.creators.map(({ name, role }) => `${name} (${role})`).join(" · ")}
    </p>
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
          <summary>Why this is here</summary>
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
  const visible = recommendation.issues.slice(0, VISIBLE_ISSUES);
  const hidden = recommendation.issues.length - visible.length;

  return (
    <>
      <ol className="issue-list">
        {visible.map((issue) => (
          <li key={issue.id}>
            <span>
              {issue.volume.name} #{issue.issueNumber}
            </span>
            <time dateTime={issue.coverDate ?? undefined}>
              {issue.coverDate ?? "Date unavailable"}
            </time>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <p className="issue-meta">
          and {hidden} more issue{hidden === 1 ? "" : "s"} through #
          {recommendation.issues.at(-1)?.issueNumber}
        </p>
      )}
    </>
  );
}

function candidateMeta(candidate: RankedRecommendation): string {
  const first = candidate.issues[0];
  const year = first.coverDate?.slice(0, 4) ?? first.volume.startYear;
  const count = candidate.issues.length;
  return `${count} issue${count === 1 ? "" : "s"}${year ? ` · ${year}` : ""}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Branches follow what the ranking actually found rather than the old
 * fixed recency buckets, which sorted by publication year and told a reader
 * nothing about why a book was worth their time.
 */
function branchCandidates(candidates: RankedRecommendation[]) {
  const branches = [
    {
      label: "Longer runs",
      description: "A longer run",
      items: [] as RankedRecommendation[],
      match: (candidate: RankedRecommendation) => candidate.type === "volume_run",
    },
    {
      label: "Complete stories",
      description: "One arc, start to finish",
      items: [] as RankedRecommendation[],
      match: (candidate: RankedRecommendation) => candidate.type === "story_arc",
    },
    {
      label: "Short reads",
      description: "One sitting",
      items: [] as RankedRecommendation[],
      match: (candidate: RankedRecommendation) => candidate.issues.length <= 3,
    },
    {
      label: "Passing appearances",
      description: "They meet, but the book is not about them",
      items: [] as RankedRecommendation[],
      match: (candidate: RankedRecommendation) => !candidate.eligibleAsStart,
    },
  ];

  for (const candidate of candidates) {
    // Gated candidates are labelled as such wherever else they might fit.
    const branch = candidate.eligibleAsStart
      ? branches.find((entry) => entry.label !== "Passing appearances" && entry.match(candidate))
      : branches.at(-1);
    if (branch && branch.items.length < 3) branch.items.push(candidate);
  }

  return branches.filter(({ items }) => items.length > 0);
}
