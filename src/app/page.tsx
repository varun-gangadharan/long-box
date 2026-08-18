import { connection } from "next/server";
import Link from "next/link";

import { Cover } from "@/components/cover";
import { SearchBox } from "@/components/search-box";
import { SiteHeader } from "@/components/site-header";
import { databaseFromEnv } from "@/lib/db/client";

type DiscoveryCharacter = {
  id: string;
  name: string;
  image_url: string | null;
  publisher: { name: string } | null;
};
type PairingIssueRow = {
  issue_id: string;
  issue_name: string | null;
  issue_number: string;
  image_url: string | null;
  volume_name: string;
};

type DiscoveryIssue = {
  id: string;
  name: string | null;
  issue_number: string;
  image_url: string | null;
  volume: { name: string } | null;
};

export default async function Home() {
  await connection();
  const { characters, issues, pairingIssues } = await loadDiscovery();

  return (
    <>
      <SiteHeader />
      <main>
        <section className="home-hero">
          <p className="section-kicker">Comic reading, without the homework</p>
          <h1>Find your way into comics</h1>
          <p>
            Pick a character or story. Long Box finds a clear place to begin and a few
            useful directions to follow.
          </p>
          <SearchBox />
        </section>

        <section className="editorial-section" aria-labelledby="start-new-heading">
          <div className="section-heading">
            <p className="section-kicker">Character index</p>
            <h2 id="start-new-heading">Start somewhere new</h2>
          </div>
          <div className="character-grid">
            {characters.map((character) => (
              <Link
                className="character-tile"
                href={`/read?characters=${encodeURIComponent(character.name)}`}
                key={character.id}
              >
                <Cover
                  imageUrl={character.image_url}
                  alt={`${character.name} character artwork`}
                />
                <h3>{character.name}</h3>
                <p>{character.publisher?.name ?? "Comic character"}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="editorial-section" aria-labelledby="from-box-heading">
          <div className="section-heading plain-heading">
            <h2 id="from-box-heading">From the long box</h2>
            <p>Recent covers from the locally indexed catalog.</p>
          </div>
          <div className="issue-strip">
            {issues.slice(0, 3).map((issue) => (
              <article className="issue-preview" key={issue.id}>
                <Cover
                  imageUrl={issue.image_url}
                  alt={`${issue.volume?.name ?? "Comic"} issue ${issue.issue_number} cover`}
                />
                <div>
                  <h3>{issue.name || `${issue.volume?.name ?? "Issue"} #${issue.issue_number}`}</h3>
                  <p>
                    {issue.volume?.name} #{issue.issue_number}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="editorial-section pairing-section" aria-labelledby="pairing-heading">
          <div>
            <h2 id="pairing-heading">Interesting pairing</h2>
            <p>
              Find issues where Spider-Man and Daredevil both appear, then choose a short
              route into their shared history.
            </p>
            <Link className="text-link" href="/read?characters=Spider-Man%2CDaredevil">
              Explore the pairing
            </Link>
          </div>
          <div className="paired-covers" aria-hidden="true">
            {pairingIssues.slice(0, 2).map((issue) => (
              <Cover imageUrl={issue.image_url} alt="" key={issue.id} />
            ))}
          </div>
        </section>
      </main>
      <footer>
        <span className="wordmark">Long Box</span>
        <p>Comic facts from ComicVine. Reading paths by Long Box.</p>
      </footer>
    </>
  );
}

async function loadDiscovery(): Promise<{
  characters: DiscoveryCharacter[];
  issues: DiscoveryIssue[];
  pairingIssues: DiscoveryIssue[];
}> {
  try {
    const database = databaseFromEnv();
    const [charactersResult, issuesResult, pairingResult] = await Promise.all([
      database
        .from("characters")
        .select("id,name,image_url,publisher:publishers(name)")
        .eq("is_canonical", true)
        .order("name")
        .limit(4),
      database
        .from("issues")
        .select("id,name,issue_number,image_url,volume:volumes(name)")
        .not("image_url", "is", null)
        .order("cover_date", { ascending: false })
        .limit(5),
      database.rpc("issues_for_characters", {
        requested_names: ["Spider-Man", "Daredevil"],
      }),
    ]);
    if (charactersResult.error || issuesResult.error || pairingResult.error) {
      throw new Error("discovery query failed");
    }
    return {
      characters: (charactersResult.data ?? []) as unknown as DiscoveryCharacter[],
      issues: (issuesResult.data ?? []) as unknown as DiscoveryIssue[],
      pairingIssues: ((pairingResult.data ?? []) as PairingIssueRow[]).map((issue) => ({
        id: issue.issue_id,
        name: issue.issue_name,
        issue_number: issue.issue_number,
        image_url: issue.image_url,
        volume: { name: issue.volume_name },
      })),
    };
  } catch {
    return { characters: [], issues: [], pairingIssues: [] };
  }
}
