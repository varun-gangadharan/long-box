import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="wordmark" href="/" aria-label="Long Box home">
        Long Box
      </Link>
      <nav aria-label="Primary navigation">
        <Link href="/">Discover</Link>
        <a href="https://github.com/varun-gangadharan/long-box">About</a>
      </nav>
    </header>
  );
}
