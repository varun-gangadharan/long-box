import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { loadEnvConfig } from "@next/env";
import { z } from "zod";

import { generateCandidates, rankCandidates } from "../src/lib/reading-path/engine";

import { loadCases, loadFixture } from "./shared";

/**
 * Qualitative second opinion on recommendation quality.
 *
 * Deliberately outside the product. Long Box's stated principle is that no model
 * invents comic facts, and nothing here feeds back into ranking — the judge only
 * reads output the deterministic engine already produced and says whether a
 * human would find it a good answer. It is opt-in, needs ANTHROPIC_API_KEY, and
 * never runs in CI, because a non-deterministic grader cannot gate a build.
 *
 *   npm run eval:judge
 *   npm run eval:judge -- nightwing
 */

loadEnvConfig(process.cwd());

const verdictSchema = z.object({
  representsThePair: z
    .number()
    .describe("1-5: how well the top results represent these characters together"),
  beginnerFriendly: z
    .number()
    .describe("1-5: how confidently a newcomer could start with the top result"),
  reasoningIsHonest: z
    .number()
    .describe("1-5: whether the stated reasons match the recommendation"),
  wouldAnExpertAgree: z.boolean(),
  critique: z.string().describe("Two sentences on what is wrong or missing"),
});

const client = new Anthropic();
const cases = loadCases(process.argv[2]);
const scores: Array<z.infer<typeof verdictSchema>> = [];

async function main(): Promise<void> {

  for (const evalCase of cases) {
    const fixture = loadFixture(evalCase.name);
    if (!fixture) {
      console.log(`SKIP ${evalCase.name} — no fixture`);
      continue;
    }

    const ranked = rankCandidates(
      generateCandidates(fixture.issues, { affinities: fixture.affinities }),
      { characterNames: evalCase.characters, characterPublishers: fixture.characterPublishers },
    ).slice(0, 3);

    const rendered = ranked
      .map((candidate, index) => {
        const gate = candidate.eligibleAsStart ? "" : " [shown as a passing appearance, not a starting point]";
        return [
          `${index + 1}. ${candidate.title}${gate}`,
          `   issues: ${candidate.issues.length}`,
          `   creators: ${candidate.creators.map(({ name, role }) => `${name} (${role})`).join(", ") || "unknown"}`,
          ...candidate.reasons.map((reason) => `   - ${reason}`),
        ].join("\n");
      })
      .join("\n\n");

    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 4000,
      system:
        "You are a comics librarian grading a recommendation engine. Someone asked where to " +
        "start reading about a set of characters. Judge whether the results are books that " +
        "are genuinely about those characters together, and whether a newcomer could start " +
        "there. Use what you know about these comics. Be strict: a book one character merely " +
        "appears in is a bad answer even if the metadata looks tidy.",
      messages: [
        {
          role: "user",
          content: `Characters: ${evalCase.characters.join(" + ")}\n\nTop results:\n\n${rendered}`,
        },
      ],
      output_config: { format: zodOutputFormat(verdictSchema) },
    });

    const verdict = response.parsed_output;
    if (!verdict) {
      console.log(`FAIL ${evalCase.name} — judge returned nothing parseable`);
      continue;
    }

    scores.push(verdict);
    console.log(`\n${evalCase.name}`);
    console.log(
      `  represents the pair ${verdict.representsThePair}/5 · beginner-friendly ${verdict.beginnerFriendly}/5 · ` +
        `reasoning honest ${verdict.reasoningIsHonest}/5 · expert agrees: ${verdict.wouldAnExpertAgree}`,
    );
    console.log(`  ${verdict.critique}`);
  }

  if (scores.length) {
    const mean = (pick: (verdict: z.infer<typeof verdictSchema>) => number) =>
      (scores.reduce((sum, verdict) => sum + pick(verdict), 0) / scores.length).toFixed(2);
    console.log("\nJudge averages");
    console.log(`  represents the pair   ${mean((v) => v.representsThePair)}/5`);
    console.log(`  beginner-friendly     ${mean((v) => v.beginnerFriendly)}/5`);
    console.log(`  reasoning is honest   ${mean((v) => v.reasoningIsHonest)}/5`);
    console.log(
      `  expert agreement      ${scores.filter((v) => v.wouldAnExpertAgree).length}/${scores.length}`,
    );
    console.log("\nAdvisory only — this never gates CI and never feeds the ranking.\n");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
