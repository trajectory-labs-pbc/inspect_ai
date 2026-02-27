import clsx from "clsx";
import {
  FC,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApplicationIcons } from "../app/appearance/icons";
import { useStore } from "../state/store";
import { findScrollableParent, scrollRangeToCenter } from "../utils/dom";
import { debounce } from "../utils/sync";
import { MatchLocation, useExtendedFind } from "./ExtendedFindContext";
import "./FindBand.css";

interface FindBandProps {}

const findConfig = {
  caseSensitive: false,
  wrapAround: false,
  wholeWord: false,
  searchInFrames: false,
  showDialog: false,
};

export const FindBand: FC<FindBandProps> = () => {
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const storeHideFind = useStore((state) => state.appActions.hideFind);
  const { extendedFindTerm, getAllMatchLocations, scrollToMatchLocation } =
    useExtendedFind();
  const lastFoundItem = useRef<{
    text: string;
    offset: number;
    parentElement: Element;
  } | null>(null);
  const currentSearchTerm = useRef<string>("");
  const needsCursorRestoreRef = useRef<boolean>(false);
  const scrollTimeoutRef = useRef<number | null>(null);
  const focusTimeoutRef = useRef<number | null>(null);
  const searchIdRef = useRef(0);
  const cachedMatches = useRef<{ term: string; matches: MatchLocation[] }>({
    term: "",
    matches: [],
  });
  const mutatedPanelsRef = useRef<
    Map<
      HTMLElement,
      {
        display: string;
        maxHeight: string;
        webkitLineClamp: string;
        webkitBoxOrient: string;
      }
    >
  >(new Map());

  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const currentMatchIndexRef = useRef(0);

  const getParentExpandablePanel = useCallback(
    (selection: Selection): HTMLElement | undefined => {
      let node = selection.anchorNode;
      while (node) {
        if (
          node instanceof HTMLElement &&
          node.hasAttribute("data-expandable-panel")
        ) {
          return node;
        }
        node = node.parentElement;
      }
      return undefined;
    },
    [],
  );

  const getMatchesForTerm = useCallback(
    (term: string): MatchLocation[] => {
      if (cachedMatches.current.term === term) {
        return cachedMatches.current.matches;
      }
      const matches = getAllMatchLocations(term);
      cachedMatches.current = { term, matches };
      return matches;
    },
    [getAllMatchLocations],
  );

  // Navigate to the next/prev match. Uses item-level navigation with
  // window.find() for intra-item cycling.
  const goToMatchLocation = useCallback(
    async (term: string, match: MatchLocation): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        const onContentReady = () => {
          let retries = 0;
          const maxRetries = 10;
          const tryHighlight = () => {
            const itemRoot = document.querySelector(
              `[data-item-index="${match.itemIndex}"]`,
            ) as HTMLElement | null;
            if (!itemRoot) {
              retries++;
              if (retries < maxRetries) {
                requestAnimationFrame(tryHighlight);
                return;
              }
              resolve(false);
              return;
            }

            // Anchor selection at the start of this item
            const sel = window.getSelection();
            if (!sel) {
              resolve(false);
              return;
            }
            const range = document.createRange();
            range.selectNodeContents(itemRoot);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);

            // Call window.find() occurrenceInItem+1 times.
            // But we count DOM occurrences, not data occurrences.
            // So occurrenceInItem=0 means "first in this item DOM".
            let found = false;
            const maxFinds = match.occurrenceInItem + 1;
            let findCount = 0;
            for (let attempt = 0; attempt < maxFinds + 20; attempt++) {
              found = windowFind(term, false);
              if (!found) break;
              if (sel.rangeCount) {
                const r = sel.getRangeAt(0);
                if (inUnsearchableElement(r)) {
                  r.collapse(false);
                  sel.removeAllRanges();
                  sel.addRange(r);
                  continue;
                }
                const parentEl =
                  r.startContainer.parentElement ||
                  (r.commonAncestorContainer as Element);
                if (!itemRoot.contains(parentEl)) {
                  found = false;
                  break;
                }
              }
              findCount++;
              if (findCount > match.occurrenceInItem) break;
            }

            if (found && sel.rangeCount) {
              const finalRange = sel.getRangeAt(0);
              const parentPanel = getParentExpandablePanel(sel);
              if (parentPanel) {
                if (!mutatedPanelsRef.current.has(parentPanel)) {
                  mutatedPanelsRef.current.set(parentPanel, {
                    display: parentPanel.style.display,
                    maxHeight: parentPanel.style.maxHeight,
                    webkitLineClamp: parentPanel.style.webkitLineClamp,
                    webkitBoxOrient: parentPanel.style.webkitBoxOrient,
                  });
                }
                parentPanel.style.display = "block";
                parentPanel.style.maxHeight = "none";
                parentPanel.style.webkitLineClamp = "";
                parentPanel.style.webkitBoxOrient = "";
              }
              if (scrollTimeoutRef.current !== null) {
                window.clearTimeout(scrollTimeoutRef.current);
              }
              scrollTimeoutRef.current = window.setTimeout(() => {
                scrollRangeToCenter(finalRange);
              }, 100);
            }

            resolve(found);
          };
          requestAnimationFrame(tryHighlight);
        };

        const didScroll = scrollToMatchLocation(match, onContentReady);
        if (!didScroll) {
          setTimeout(onContentReady, 0);
        }
      });
    },
    [scrollToMatchLocation, getParentExpandablePanel],
  );

  const handleSearch = useCallback(
    async (back = false) => {
      const thisSearchId = ++searchIdRef.current;

      const searchTerm = searchBoxRef.current?.value ?? "";
      if (!searchTerm) {
        setMatchCount(null);
        setCurrentMatchIndex(0);
        return;
      }

      const termChanged = currentSearchTerm.current !== searchTerm;
      if (termChanged) {
        lastFoundItem.current = null;
        currentSearchTerm.current = searchTerm;
        setCurrentMatchIndex(0);
        currentMatchIndexRef.current = 0;
        cachedMatches.current = { term: "", matches: [] };
      }

      const matches = getMatchesForTerm(searchTerm);
      const total = matches.length;
      setMatchCount(total);

      if (total === 0) {
        setCurrentMatchIndex(0);
        return;
      }

      // Compute target match index (0-based)
      const prevIndex0 =
        currentMatchIndexRef.current > 0
          ? currentMatchIndexRef.current - 1
          : -1;
      const targetIndex0 =
        termChanged || prevIndex0 === -1
          ? back
            ? total - 1
            : 0
          : back
            ? (prevIndex0 - 1 + total) % total
            : (prevIndex0 + 1) % total;

      const targetMatch = matches[targetIndex0];

      // Set the match index immediately — don't wait for goToMatchLocation.
      // The match list is computed from data, so we know it's correct.
      setCurrentMatchIndex(targetIndex0 + 1);
      currentMatchIndexRef.current = targetIndex0 + 1;

      if (searchIdRef.current !== thisSearchId) return;
      await goToMatchLocation(searchTerm, targetMatch);
    },
    [getMatchesForTerm, goToMatchLocation],
  );

  useEffect(() => {
    focusTimeoutRef.current = window.setTimeout(() => {
      searchBoxRef.current?.focus();
      searchBoxRef.current?.select();
    }, 10);

    const mutatedPanels = mutatedPanelsRef.current;
    const scrollTimeout = scrollTimeoutRef.current;
    const focusTimeout = focusTimeoutRef.current;

    return () => {
      if (scrollTimeout !== null) {
        window.clearTimeout(scrollTimeout);
      }
      if (focusTimeout !== null) {
        window.clearTimeout(focusTimeout);
      }
      // Restore original styles on mutated expandable panels
      mutatedPanels.forEach((originalStyles, panel) => {
        panel.style.display = originalStyles.display;
        panel.style.maxHeight = originalStyles.maxHeight;
        panel.style.webkitLineClamp = originalStyles.webkitLineClamp;
        panel.style.webkitBoxOrient = originalStyles.webkitBoxOrient;
      });
      mutatedPanels.clear();
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        storeHideFind();
      } else if (e.key === "Enter") {
        void handleSearch(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        void handleSearch(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        searchBoxRef.current?.focus();
        searchBoxRef.current?.select();
      }
    },
    [storeHideFind, handleSearch],
  );

  const findPrevious = useCallback(() => {
    void handleSearch(true);
  }, [handleSearch]);

  const findNext = useCallback(() => {
    void handleSearch(false);
  }, [handleSearch]);

  const restoreCursor = useCallback(() => {
    if (!needsCursorRestoreRef.current) return;
    needsCursorRestoreRef.current = false;
    const input = searchBoxRef.current;
    if (input) {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }, []);

  const debouncedSearch = useMemo(
    () =>
      debounce(async () => {
        if (!searchBoxRef.current) return;
        await handleSearch(false);
        // Mark for cursor restore on next keypress (keeps find highlight visible)
        needsCursorRestoreRef.current = true;
      }, 100),
    [handleSearch],
  );

  const handleInputChange = useCallback(() => {
    debouncedSearch();
  }, [debouncedSearch]);

  const handleBeforeInput = useCallback(() => {
    // Clear the restore flag — the user is actively editing,
    // so the cursor is already where they want it.
    needsCursorRestoreRef.current = false;
  }, []);

  // Consolidated global keyboard handler
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // F3: Find next/previous
      if (e.key === "F3") {
        e.preventDefault();
        void handleSearch(e.shiftKey);
        return;
      }

      // Ctrl/Cmd+F: Focus search box (block browser find)
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        searchBoxRef.current?.focus();
        searchBoxRef.current?.select();
        return;
      }

      // Ctrl/Cmd+G: Find next/previous
      if ((e.ctrlKey || e.metaKey) && e.key === "g") {
        e.preventDefault();
        e.stopPropagation();
        void handleSearch(e.shiftKey);
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key.length !== 1 && e.key !== "Backspace" && e.key !== "Delete")
        return;

      const input = searchBoxRef.current;
      if (!input) return;

      // Only restore cursor and focus if the input doesn't already have focus.
      // If the user is actively editing in the input, don't move their cursor.
      if (document.activeElement !== input) {
        restoreCursor();
        input.focus();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [handleSearch, restoreCursor]);

  const matchCountLabel = useMemo(() => {
    if (matchCount === null) return null;
    if (matchCount === 0) return "No results";
    return `${currentMatchIndex} of ${matchCount}`;
  }, [matchCount, currentMatchIndex]);

  return (
    <div data-unsearchable="true" className={clsx("findBand")}>
      <input
        type="text"
        ref={searchBoxRef}
        placeholder="Find"
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput}
        onChange={handleInputChange}
      />
      {matchCountLabel !== null && (
        <span
          className={clsx(
            "findBand-match-count",
            matchCount === 0 && "findBand-no-results",
          )}
        >
          {matchCountLabel}
        </span>
      )}
      <button
        type="button"
        title="Previous match"
        className="btn next"
        onClick={findPrevious}
      >
        <i className={ApplicationIcons.arrows.up} />
      </button>
      <button
        type="button"
        title="Next match"
        className="btn prev"
        onClick={findNext}
      >
        <i className={ApplicationIcons.arrows.down} />
      </button>
      <button
        type="button"
        title="Close"
        className="btn close"
        onClick={storeHideFind}
      >
        <i className={ApplicationIcons.close} />
      </button>
    </div>
  );
};
function windowFind(searchTerm: string, back: boolean): boolean {
  // @ts-expect-error: `Window.find` is non-standard
  return window.find(
    searchTerm,
    findConfig.caseSensitive,
    back,
    findConfig.wrapAround,
    findConfig.wholeWord,
    findConfig.searchInFrames,
    findConfig.showDialog,
  ) as boolean;
}

function positionSelectionForWrap(back: boolean): void {
  if (!back) return;
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(document.body);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

async function findExtendedInDOM(
  searchTerm: string,
  back: boolean,
  lastFoundItem: {
    text: string;
    offset: number;
    parentElement: Element;
  } | null,
  extendedFindTerm: (
    term: string,
    direction: "forward" | "backward",
  ) => Promise<boolean>,
) {
  let result = false;
  let hasTriedExtendedSearch = false;
  let extendedSearchSucceeded = false;
  const maxAttempts = 25;

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    result = windowFind(searchTerm, back);

    if (result) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const isUnsearchable = inUnsearchableElement(range);
        const isSameAsLast = isLastFoundItem(range, lastFoundItem);

        if (!isUnsearchable && !isSameAsLast) {
          break;
        }

        if (isSameAsLast) {
          if (!hasTriedExtendedSearch) {
            hasTriedExtendedSearch = true;
            window.getSelection()?.removeAllRanges();

            const foundInVirtual = await extendedFindTerm(
              searchTerm,
              back ? "backward" : "forward",
            );

            if (foundInVirtual) {
              extendedSearchSucceeded = true;
              continue;
            }
          }

          if (extendedSearchSucceeded) {
            // Extended search scrolled to new content but old match is still in DOM.
            // Collapse past it so windowFind advances to the new match.
            const sel = window.getSelection();
            if (sel?.rangeCount) {
              sel.getRangeAt(0).collapse(!back);
            }
          } else {
            window.getSelection()?.removeAllRanges();
            positionSelectionForWrap(back);
          }

          result = windowFind(searchTerm, back);
          if (result) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const r = sel.getRangeAt(0);
              if (inUnsearchableElement(r)) {
                continue;
              }
            }
          }
          break;
        }
      }
    } else if (!hasTriedExtendedSearch) {
      hasTriedExtendedSearch = true;
      window.getSelection()?.removeAllRanges();

      const foundInVirtual = await extendedFindTerm(
        searchTerm,
        back ? "backward" : "forward",
      );

      if (foundInVirtual) {
        extendedSearchSucceeded = true;
        continue;
      }

      positionSelectionForWrap(back);
      result = windowFind(searchTerm, back);
      if (result) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const r = sel.getRangeAt(0);
          if (inUnsearchableElement(r)) {
            continue;
          }
        }
      }
      break;
    } else {
      break;
    }
  }

  if (result) {
    const sel = window.getSelection();
    if (sel?.rangeCount && inUnsearchableElement(sel.getRangeAt(0))) {
      sel.removeAllRanges();
      result = false;
    }
  }

  return result;
}

function isLastFoundItem(
  range: Range,
  lastFoundItem: {
    text: string;
    offset: number;
    parentElement: Element;
  } | null,
) {
  if (!lastFoundItem) return false;

  const currentText = range.toString();
  const currentOffset = range.startOffset;
  const currentParentElement =
    range.startContainer.parentElement ||
    (range.commonAncestorContainer as Element);

  return (
    currentText === lastFoundItem.text &&
    currentOffset === lastFoundItem.offset &&
    currentParentElement === lastFoundItem.parentElement
  );
}

function inUnsearchableElement(range: Range) {
  let element: Element | null = selectionParentElement(range);

  // Check if this match is inside an unsearchable element
  let isUnsearchable = false;
  while (element) {
    if (
      element.hasAttribute("data-unsearchable") ||
      getComputedStyle(element).userSelect === "none"
    ) {
      isUnsearchable = true;
      break;
    }
    element = element.parentElement;
  }
  return isUnsearchable;
}

function selectionParentElement(range: Range) {
  let element: Element | null = null;

  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    // This is a direct element
    element = range.startContainer as Element;
  } else {
    // This isn't an element, try its parent
    element = range.startContainer.parentElement;
  }

  // Still not found, try the common ancestor container
  if (
    !element &&
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
  ) {
    element = range.commonAncestorContainer as Element;
  } else if (!element && range.commonAncestorContainer.parentElement) {
    element = range.commonAncestorContainer.parentElement;
  }
  return element;
}
