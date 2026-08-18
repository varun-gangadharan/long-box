import { SiteHeader } from "@/components/site-header";

export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className="reading-page" aria-busy="true" aria-label="Building reading path">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-feature" />
        <div className="skeleton skeleton-row" />
      </main>
    </>
  );
}
