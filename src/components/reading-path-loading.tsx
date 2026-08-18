/**
 * The wait this covers is not uniform. A pair somebody has already searched
 * comes back in about a second; a pair nobody has searched sends Long Box off to
 * read both characters' entire publication histories, which takes about a
 * minute. A shimmering skeleton is fine for the first case and dishonest for the
 * second — it suggests the page is nearly there when it has barely started.
 *
 * So this says what is actually happening, and says plainly that the wait is
 * one-off. Setting the expectation is worth more than any animation.
 *
 * Everything here is CSS and static markup on purpose. React does not hydrate
 * the contents of a Suspense fallback while the boundary is still pending, so
 * the streamed markup is inert: a `useEffect` never fires and a timer-driven
 * message would sit on its first line for the whole minute. CSS animation is the
 * only thing that runs.
 */

/**
 * Roughly tracks the real pipeline: resolve both characters, cache their
 * appearance lists, intersect them, then pull detail for the books that survive.
 * The timings are an approximation — the server reports no progress — so each
 * line describes work that genuinely happens rather than claiming a step is done.
 */
const STAGES = [
  { at: 0, message: "Looking up both characters." },
  { at: 4, message: "Reading everything they have each appeared in." },
  { at: 12, message: "Working out which books they genuinely share." },
  { at: 28, message: "Checking who else is in those issues, and who made them." },
  { at: 50, message: "Sorting the shared books into somewhere worth starting." },
  { at: 75, message: "Nearly there. This pair is a big one." },
] as const;

export function ReadingPathLoading() {
  return (
    <main className="reading-page loading-page" aria-busy="true">
      <div className="long-box-loader">
        <LongBox />

        <div className="long-box-copy">
          <p className="section-kicker">Pulling the long box</p>
          <h1>Reading around these characters</h1>

          {/*
            The cycling lines are decorative timing, not content: a screen reader
            would otherwise read all six at once. One honest static line is
            announced instead, since without hydration there is nothing to update.
          */}
          <p className="loading-stage" aria-hidden="true">
            {STAGES.map((stage, index) => (
              <span
                key={stage.message}
                className={index === STAGES.length - 1 ? "stage-line stage-line-last" : "stage-line"}
                style={{
                  animationDelay: `${stage.at}s`,
                  animationDuration:
                    index === STAGES.length - 1
                      ? "1.2s"
                      : `${STAGES[index + 1].at - stage.at}s`,
                }}
              >
                {stage.message}
              </span>
            ))}
          </p>

          <p className="visually-hidden" role="status">
            Long Box is reading everything these characters have appeared in. This
            usually takes about a minute.
          </p>

          <p className="loading-note">
            The first search for a pair reads their whole shared history, which takes
            about a minute. Every search after this one is instant.
          </p>
        </div>
      </div>
    </main>
  );
}

/**
 * Comics riffled through in a storage box: five issues standing out of the box
 * front, each lifting in turn the way a finger walks along the boxes at a shop.
 * Decorative, so it is hidden from assistive technology.
 */
function LongBox() {
  return (
    <div className="long-box" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <span key={index} className="long-box-issue" style={{ animationDelay: `${index * 0.16}s` }} />
      ))}
    </div>
  );
}
