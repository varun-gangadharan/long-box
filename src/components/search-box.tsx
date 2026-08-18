"use client";

import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, useEffect, useId, useState } from "react";

import type { CatalogSearchResult } from "@/lib/catalog/search";

export function SearchBox() {
  const router = useRouter();
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [selected, setSelected] = useState<CatalogSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (query.trim().length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("search failed");
        const body = (await response.json()) as { results: CatalogSearchResult[] };
        setResults(
          body.results.filter(
            (result) => !selected.some((entity) => entity.id === result.id),
          ),
        );
        setActiveIndex(body.results.length ? 0 : -1);
        setStatus("idle");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
        setResults([]);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected]);

  function selectEntity(entity: CatalogSearchResult) {
    setSelected((current) =>
      entity.type === "story_arc"
        ? [entity]
        : [...current.filter(({ type }) => type === "character"), entity].slice(0, 3),
    );
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    setStatus("idle");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectEntity(results[activeIndex]);
    } else if (event.key === "Escape") {
      setResults([]);
      setActiveIndex(-1);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected.length) return;
    const storyArc = selected.find(({ type }) => type === "story_arc");
    router.push(
      storyArc
        ? `/read?storyArc=${encodeURIComponent(storyArc.name)}`
        : `/read?characters=${encodeURIComponent(selected.map(({ name }) => name).join(","))}`,
    );
  }

  return (
    <form className="search-composer" onSubmit={submit}>
      <label htmlFor="catalog-search">What do you want to read?</label>
      {selected.length > 0 && (
        <div className="entity-tokens" aria-label="Selected topics">
          {selected.map((entity) => (
            <span className="entity-token" key={entity.id}>
              {entity.name}
              <button
                type="button"
                aria-label={`Remove ${entity.name}`}
                onClick={() => setSelected((current) => current.filter(({ id }) => id !== entity.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="search-row">
        <div className="search-field">
          <input
            id="catalog-search"
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (value.trim().length < 2) {
                setResults([]);
                setStatus("idle");
              }
            }}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
            placeholder={selected.length ? "Add another character" : "Search characters or story arcs"}
            autoComplete="off"
          />
          {(results.length > 0 || status !== "idle") && (
            <div className="search-popover">
              {status === "loading" && <p role="status">Searching the long box…</p>}
              {status === "error" && <p role="alert">Search is unavailable. Try again.</p>}
              {status === "idle" && results.length > 0 && (
                <ul id={listboxId} role="listbox">
                  {results.map((result, index) => (
                    <li
                      id={`${listboxId}-${index}`}
                      key={result.id}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <button type="button" onClick={() => selectEntity(result)}>
                        <span>{result.name}</span>
                        <small>{result.context ?? result.type.replace("_", " ")}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <button className="primary-button" type="submit" disabled={!selected.length}>
          Find my way in
        </button>
      </div>
      <p className="search-help">Choose up to three characters, or one story arc.</p>
      <div className="example-links" aria-label="Example searches">
        <span>Try</span>
        {[
          ["Daredevil", "/read?characters=Daredevil"],
          ["Spider-Man", "/read?characters=Spider-Man"],
          ["Spider-Man + Daredevil", "/read?characters=Spider-Man%2CDaredevil"],
        ].map(([label, href]) => (
          <button type="button" key={label} onClick={() => router.push(href)}>
            {label}
          </button>
        ))}
      </div>
    </form>
  );
}
