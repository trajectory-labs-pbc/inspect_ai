import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useRef,
} from "react";

// The search context provides global search assistance for virtualized lists.
// With virtualization, most items are not in the DOM — the search system
// operates at the data level and scrolls items into view as needed.

// Legacy: used by findExtendedInDOM as a fallback
export type ExtendedFindFn = (
  term: string,
  direction: "forward" | "backward",
  onContentReady: () => void,
) => Promise<boolean>;

// Count total matches across all data items
export type ExtendedCountFn = (term: string) => number;

// A concrete match location within a virtual list.
// Ordering is always top-to-bottom by itemIndex, then by occurrenceInItem.
export type MatchLocation = {
  listId: string;
  itemIndex: number;
  occurrenceInItem: number;
};

// Build a full ordered match index for a list.
export type ExtendedMatchIndexFn = (term: string) => MatchLocation[];

// Scroll a list to a particular item index and call onContentReady once the
// DOM has settled enough for highlight work (e.g. window.find) to run.
export type ExtendedScrollToIndexFn = (
  itemIndex: number,
  onContentReady: () => void,
) => void;

interface ExtendedFindContextType {
  // Legacy — kept for findExtendedInDOM fallback
  extendedFindTerm: (
    term: string,
    direction: "forward" | "backward",
  ) => Promise<boolean>;
  registerVirtualList: (id: string, searchFn: ExtendedFindFn) => () => void;

  // Match counting
  countAllMatches: (term: string) => number;
  registerMatchCounter: (id: string, countFn: ExtendedCountFn) => () => void;

  // Deterministic match navigation
  getAllMatchLocations: (term: string) => MatchLocation[];
  registerMatchIndexer: (
    id: string,
    indexFn: ExtendedMatchIndexFn,
  ) => () => void;

  // Deterministic scroll-to-item
  scrollToMatchLocation: (
    match: MatchLocation,
    onContentReady: () => void,
  ) => boolean;
  registerIndexScroller: (
    id: string,
    scrollFn: ExtendedScrollToIndexFn,
  ) => () => void;
}

const ExtendedFindContext = createContext<ExtendedFindContextType | null>(null);

interface ExtendedFindProviderProps {
  children: ReactNode;
}

export const ExtendedFindProvider = ({
  children,
}: ExtendedFindProviderProps) => {
  const virtualLists = useRef<Map<string, ExtendedFindFn>>(new Map());
  const matchCounters = useRef<Map<string, ExtendedCountFn>>(new Map());
  const matchIndexers = useRef<Map<string, ExtendedMatchIndexFn>>(new Map());
  const indexScrollers = useRef<Map<string, ExtendedScrollToIndexFn>>(
    new Map(),
  );

  const extendedFindTerm = useCallback(
    async (
      term: string,
      direction: "forward" | "backward",
    ): Promise<boolean> => {
      for (const [, searchFn] of virtualLists.current) {
        const found = await new Promise<boolean>((resolve) => {
          let callbackFired = false;

          const onContentReady = () => {
            if (!callbackFired) {
              callbackFired = true;
              resolve(true);
            }
          };

          searchFn(term, direction, onContentReady)
            .then((found) => {
              if (!found && !callbackFired) {
                callbackFired = true;
                resolve(false);
              }
            })
            .catch(() => {
              if (!callbackFired) {
                callbackFired = true;
                resolve(false);
              }
            });
        });

        if (found) {
          return true;
        }
      }
      return false;
    },
    [],
  );

  const registerVirtualList = useCallback(
    (id: string, searchFn: ExtendedFindFn): (() => void) => {
      virtualLists.current.set(id, searchFn);
      return () => {
        virtualLists.current.delete(id);
      };
    },
    [],
  );

  const countAllMatches = useCallback((term: string): number => {
    let total = 0;
    for (const [, countFn] of matchCounters.current) {
      total += countFn(term);
    }
    return total;
  }, []);

  const registerMatchCounter = useCallback(
    (id: string, countFn: ExtendedCountFn): (() => void) => {
      matchCounters.current.set(id, countFn);
      return () => {
        matchCounters.current.delete(id);
      };
    },
    [],
  );

  const getAllMatchLocations = useCallback((term: string): MatchLocation[] => {
    if (!term) return [];
    const matches: MatchLocation[] = [];
    for (const [, indexFn] of matchIndexers.current) {
      try {
        matches.push(...indexFn(term));
      } catch {
        // Best-effort
      }
    }
    return matches;
  }, []);

  const registerMatchIndexer = useCallback(
    (id: string, indexFn: ExtendedMatchIndexFn): (() => void) => {
      matchIndexers.current.set(id, indexFn);
      return () => {
        matchIndexers.current.delete(id);
      };
    },
    [],
  );

  const scrollToMatchLocation = useCallback(
    (match: MatchLocation, onContentReady: () => void): boolean => {
      const scrollFn = indexScrollers.current.get(match.listId);
      if (!scrollFn) return false;
      scrollFn(match.itemIndex, onContentReady);
      return true;
    },
    [],
  );

  const registerIndexScroller = useCallback(
    (id: string, scrollFn: ExtendedScrollToIndexFn): (() => void) => {
      indexScrollers.current.set(id, scrollFn);
      return () => {
        indexScrollers.current.delete(id);
      };
    },
    [],
  );

  const contextValue: ExtendedFindContextType = {
    extendedFindTerm,
    registerVirtualList,
    countAllMatches,
    registerMatchCounter,
    getAllMatchLocations,
    registerMatchIndexer,
    scrollToMatchLocation,
    registerIndexScroller,
  };

  return (
    <ExtendedFindContext.Provider value={contextValue}>
      {children}
    </ExtendedFindContext.Provider>
  );
};

export const useExtendedFind = (): ExtendedFindContextType => {
  const context = useContext(ExtendedFindContext);
  if (!context) {
    throw new Error("useSearch must be used within a SearchProvider");
  }
  return context;
};
