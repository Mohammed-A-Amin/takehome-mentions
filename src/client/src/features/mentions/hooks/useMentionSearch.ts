import { useEffect, useRef, useState } from "react";
import { searchPages, searchPeople } from "../api";
import type { MentionResult } from "../types";

const QUERY_DEBOUNCE_MS = 125;

type EmptyResults = { people: MentionResult[]; pages: MentionResult[] };
let emptyResultsPromise: Promise<EmptyResults> | undefined;

/** Warm or refresh the empty-query data used by the initial @ menu. */
export function prefetchEmptyResults(forceRefresh = false): Promise<EmptyResults> {
  if (!emptyResultsPromise || forceRefresh) {
    emptyResultsPromise = Promise.allSettled([searchPeople(""), searchPages("")]).then(
      ([people, pages]) => ({
        people: people.status === "fulfilled" ? people.value : [],
        pages: pages.status === "fulfilled" ? pages.value : [],
      }),
    );
  }
  return emptyResultsPromise;
}

type UseMentionSearchOptions = {
  isMenuOpen: boolean;
  query: string | null;
};

/** Manage debounced, cancellable People and Page searches for the mention menu. */
export function useMentionSearch({ isMenuOpen, query }: UseMentionSearchOptions) {
  const [results, setResults] = useState<MentionResult[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef(0);
  const hiddenResultIds = useRef(new Set<string>());

  const publishResults = (nextResults: MentionResult[]) => {
    setResults(nextResults.filter((result) => !hiddenResultIds.current.has(result.id)));
  };

  useEffect(() => {
    void prefetchEmptyResults();
  }, []);

  useEffect(() => {
    if (!isMenuOpen || query === null) {
      setResults([]);
      return;
    }

    const currentRequestId = ++requestId.current;
    if (query === "") {
      void prefetchEmptyResults().then(({ people, pages }) => {
        if (currentRequestId === requestId.current) publishResults([...people, ...pages]);
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      let nextPeople: MentionResult[] = [];
      let nextPages: MentionResult[] = [];
      const publish = () => {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        publishResults([...nextPeople, ...nextPages]);
      };

      void searchPeople(query, controller.signal)
        .then((people) => {
          nextPeople = people;
          publish();
        })
        .catch(() => undefined);
      void searchPages(query, controller.signal)
        .then((pages) => {
          nextPages = pages;
          publish();
        })
        .catch(() => undefined);
    }, QUERY_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isMenuOpen, query, refreshKey]);

  return {
    results,
    refresh: () => setRefreshKey((key) => key + 1),
    removeResult: (id: string) => {
      hiddenResultIds.current.add(id);
      setResults((current) => current.filter((result) => result.id !== id));
    },
    restoreResult: (result: MentionResult) => {
      hiddenResultIds.current.delete(result.id);
      setResults((current) =>
        current.some((existing) => existing.id === result.id) ? current : [...current, result],
      );
    },
  };
}
