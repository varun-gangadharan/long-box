import { generateCandidates, rankCandidates } from "../src/lib/reading-path/engine";
import type { RankedRecommendation } from "../src/lib/reading-path/types";

import { loadCases, loadFixture, matches, type EvalCase, type Fixture } from "./shared";

/**
 * Offline recommendation quality gate.
 *
 * Runs the ranking engine over frozen fixtures — no network, no database — and
 * checks each case against hand-labelled expectations. Unit tests prove the
 * engine computes what it says it computes; this proves the answers are good.
 *
 *   npm run eval              every case
 *   npm run eval -- titans    cases whose name contains "titans"
 */

const THRESHOLDS = {
  precisionAt1: 1,
  recallAt3: 0.75,
  trapRate: 0,
};

type CaseResult = {
  name: string;
  source: Fixture["source"];
  passed: boolean;
  failures: string[];
  top: RankedRecommendation[];
  hitTop1: boolean;
  recallAt3: number;
  trapped: boolean;
};

function evaluate(evalCase: EvalCase, fixture: Fixture): CaseResult {
  const ranked = rankCandidates(
    generateCandidates(fixture.issues, { affinities: fixture.affinities }),
    { characterNames: evalCase.characters, characterPublishers: fixture.characterPublishers },
  );
  const top = ranked.slice(0, 3);
  const failures: string[] = [];

  const [best] = ranked;
  if (!best) {
    return {
      name: evalCase.name,
      source: fixture.source,
      passed: false,
      failures: ["no recommendations produced"],
      top: [],
      hitTop1: false,
      recallAt3: 0,
      trapped: false,
    };
  }

  if (evalCase.expect.expectNoStrongMatch) {
    const passed = !best.eligibleAsStart;
    if (!passed) {
      failures.push(
        `expected no confident starting point, but "${best.title}" passed the gate`,
      );
    }
    return {
      name: evalCase.name,
      source: fixture.source,
      passed,
      failures,
      top,
      hitTop1: passed,
      recallAt3: passed ? 1 : 0,
      trapped: false,
    };
  }

  const hitTop1 =
    evalCase.expect.top1AnyOf.length === 0 ||
    evalCase.expect.top1AnyOf.some((expected) => matches(best.title, expected));
  if (!hitTop1) {
    failures.push(
      `top result "${best.title}" is none of: ${evalCase.expect.top1AnyOf.join(", ")}`,
    );
  }

  if (!best.eligibleAsStart) {
    failures.push(`top result "${best.title}" did not pass the togetherness gate`);
  }

  const minTogetherness = evalCase.expect.minTogetherness;
  if (minTogetherness !== undefined && best.features.togetherness < minTogetherness) {
    failures.push(
      `togetherness ${best.features.togetherness.toFixed(3)} is below the required ${minTogetherness}`,
    );
  }

  const maxTogetherness = evalCase.expect.maxTogetherness;
  if (maxTogetherness !== undefined && best.features.togetherness > maxTogetherness) {
    failures.push(
      `togetherness ${best.features.togetherness.toFixed(3)} overstates a crossover-only pair (max ${maxTogetherness})`,
    );
  }

  const wanted = evalCase.expect.top3AnyOf;
  const found = wanted.filter((expected) =>
    top.some((candidate) => matches(candidate.title, expected)),
  );
  const recallAt3 = wanted.length ? found.length / wanted.length : 1;
  if (recallAt3 < THRESHOLDS.recallAt3) {
    const missing = wanted.filter((expected) => !found.includes(expected));
    failures.push(`missing from the top three: ${missing.join(", ")}`);
  }

  // A known bad answer counts as a trap only when it is offered as a real
  // recommendation. The product labels gated candidates as passing appearances
  // and never presents them as a starting point, so a trap that is correctly
  // gated is the engine working, not failing.
  const traps = evalCase.expect.mustNotAppearTop3.filter((trap) =>
    top.some((candidate) => candidate.eligibleAsStart && matches(candidate.title, trap)),
  );
  if (traps.length) failures.push(`known bad answers recommended in the top three: ${traps.join(", ")}`);

  const mislabelled = evalCase.expect.mustNotAppearTop3.filter((trap) =>
    top.some(
      (candidate) =>
        matches(candidate.title, trap) &&
        !candidate.reasons.some((reason) => reason.startsWith("Be warned:")),
    ),
  );
  if (mislabelled.length) {
    failures.push(`shown without a warning: ${mislabelled.join(", ")}`);
  }

  return {
    name: evalCase.name,
    source: fixture.source,
    passed: failures.length === 0,
    failures,
    top,
    hitTop1,
    recallAt3,
    trapped: traps.length > 0,
  };
}

function report(results: CaseResult[], missing: string[]): boolean {
  console.log("\nRecommendation quality\n");

  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name}  [${result.source}]`);
    for (const [index, candidate] of result.top.entries()) {
      const gate = candidate.eligibleAsStart ? "" : "  (gated)";
      console.log(
        `        ${index + 1}. ${candidate.title} — together ${candidate.features.togetherness.toFixed(2)}, ` +
          `beginner ${candidate.features.beginnerFriendliness.toFixed(2)}${gate}`,
      );
    }
    for (const failure of result.failures) console.log(`        ! ${failure}`);
  }

  for (const name of missing) {
    console.log(`SKIP  ${name}  no fixture — run: npm run eval:record -- ${name}`);
  }

  if (!results.length) {
    console.log("\nNo fixtures available, so nothing was scored.\n");
    return false;
  }

  const precisionAt1 = results.filter(({ hitTop1 }) => hitTop1).length / results.length;
  const recallAt3 =
    results.reduce((sum, { recallAt3: value }) => sum + value, 0) / results.length;
  const trapRate = results.filter(({ trapped }) => trapped).length / results.length;

  console.log("\nScorecard");
  console.log(`  cases          ${results.length} (${missing.length} skipped)`);
  console.log(`  precision@1    ${precisionAt1.toFixed(2)}  (need ${THRESHOLDS.precisionAt1})`);
  console.log(`  recall@3       ${recallAt3.toFixed(2)}  (need ${THRESHOLDS.recallAt3})`);
  console.log(`  trap rate      ${trapRate.toFixed(2)}  (need ${THRESHOLDS.trapRate})`);

  const passed =
    results.every(({ passed: casePassed }) => casePassed) &&
    precisionAt1 >= THRESHOLDS.precisionAt1 &&
    recallAt3 >= THRESHOLDS.recallAt3 &&
    trapRate <= THRESHOLDS.trapRate;

  console.log(`\n${passed ? "Recommendation quality gate passed." : "Recommendation quality gate FAILED."}\n`);
  return passed;
}

const filter = process.argv[2];
const cases = loadCases(filter);
const results: CaseResult[] = [];
const missing: string[] = [];

for (const evalCase of cases) {
  const fixture = loadFixture(evalCase.name);
  if (!fixture) {
    missing.push(evalCase.name);
    continue;
  }
  results.push(evaluate(evalCase, fixture));
}

process.exit(report(results, missing) ? 0 : 1);
