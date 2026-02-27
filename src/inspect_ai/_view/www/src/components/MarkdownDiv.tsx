import clsx from "clsx";
import {
  CSSProperties,
  forwardRef,
  memo,
  startTransition,
  useEffect,
  useState,
} from "react";
import "./MarkdownDiv.css";
import {
  escapeHtmlCharacters,
  getMarkdownInstance,
  preRenderText,
  protectBackslashesInLatex,
  protectMarkdown,
  restoreBackslashesForLatex,
  unescapeCodeHtmlEntities,
  unescapeSupHtmlEntities,
  unprotectMarkdown,
} from "./markdownRendering";

// Quick check for math patterns in content
const hasMathContent = (text: string): boolean => {
  return text.includes("$") || text.includes("\\(") || text.includes("\\[");
};

interface MarkdownDivProps {
  markdown: string;
  omitMedia?: boolean;
  omitMath?: boolean;
  style?: CSSProperties;
  className?: string | string[];
}

const MarkdownDivComponent = forwardRef<HTMLDivElement, MarkdownDivProps>(
  ({ markdown, omitMedia, omitMath, style, className }, ref) => {
    // Check cache for rendered content
    const optionsKey = `${omitMedia ? "1" : "0"}:${omitMath ? "1" : "0"}`;
    const cacheKey = `${markdown}:${optionsKey}`;
    const cachedHtml = renderCache.get(cacheKey);

    const sanitizeMarkdown = (md: string): string => {
      // Basic sanitization to prevent script tags and event handlers
      const escapedBr = md.replace(/\n/g, "<br/>");
      return escapeHtmlCharacters(escapedBr);
    };

    // Initialize with content (cached or unrendered markdown)
    const [renderedHtml, setRenderedHtml] = useState<string>(() => {
      if (cachedHtml) {
        return cachedHtml;
      }
      return sanitizeMarkdown(markdown);
    });

    useEffect(() => {
      // If already cached, no need to re-render
      if (cachedHtml) {
        // Only update state if it's different (avoid unnecessary re-render)
        if (renderedHtml !== cachedHtml) {
          startTransition(() => {
            setRenderedHtml(cachedHtml);
          });
        }
        return;
      }

      // Reset to raw markdown text when markdown changes (keep this synchronous for immediate feedback)
      setRenderedHtml(sanitizeMarkdown(markdown));

      // Process markdown asynchronously using the coordinator.
      // The coordinator batches completions from multiple MarkdownDiv
      // instances into a single startTransition → one React commit.
      const { cancel } = renderCoordinator.enqueue(
        cacheKey,
        async () => {
          // Full markdown preprocessing pipeline
          const protectedContent = protectBackslashesInLatex(markdown);
          const escaped = escapeHtmlCharacters(protectedContent);
          const preRendered = preRenderText(escaped);
          const protectedText = protectMarkdown(preRendered);
          const preparedForMarkdown = restoreBackslashesForLatex(protectedText);

          let html = preparedForMarkdown;
          try {
            const contentHasMath = hasMathContent(markdown);
            const md = await getMarkdownInstance(
              omitMedia,
              omitMath,
              contentHasMath,
            );
            html = md.render(preparedForMarkdown);
          } catch (ex) {
            console.log("Unable to markdown render content");
            console.error(ex);
          }

          const unescaped = unprotectMarkdown(html);
          const withCode = unescapeCodeHtmlEntities(unescaped);
          const withSup = unescapeSupHtmlEntities(withCode);

          return withSup;
        },
        (result) => {
          // This callback is called INSIDE the coordinator's startTransition,
          // batched with other MarkdownDiv completions → ONE React commit.
          if (renderCache.size >= MAX_CACHE_SIZE) {
            const firstKey = renderCache.keys().next().value;
            if (firstKey) {
              renderCache.delete(firstKey);
            }
          }
          renderCache.set(cacheKey, result);
          setRenderedHtml(result);
        },
      );

      return () => {
        cancel();
      };

      // intentionally excluded: including it causes wasteful re-runs when the
      // async render completes and updates state (30-50 extra effect evaluations
      // per sample load). The effect only needs to re-run when the SOURCE data
      // changes (markdown, options, cacheKey), not when the output updates.
    }, [markdown, omitMedia, omitMath, cachedHtml, cacheKey]);

    return (
      <div
        ref={ref}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
        style={style}
        className={clsx(className, "markdown-content")}
      />
    );
  },
);

// Memoize component to prevent re-renders when props haven't changed
export const MarkdownDiv = memo(MarkdownDivComponent);

// Cache for rendered markdown to avoid re-processing identical content
const renderCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;

// Markdown rendering queue to make markdown rendering async while limiting concurrency
interface QueueTask {
  task: () => Promise<void>;
  cancelled: boolean;
}

class MarkdownRenderQueue {
  private queue: QueueTask[] = [];
  private activeCount = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  enqueue<T>(task: () => Promise<T>): {
    promise: Promise<T>;
    cancel: () => void;
  } {
    let cancelled = false;

    const promise = new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        // Skip if cancelled before execution
        if (cancelled) {
          return;
        }

        try {
          const result = await task();
          if (!cancelled) {
            resolve(result);
          }
        } catch (error) {
          if (!cancelled) {
            reject(error);
          }
        }
      };

      const queueTask: QueueTask = {
        task: wrappedTask,
        cancelled: false,
      };

      this.queue.push(queueTask);
      this.processQueue();
    });

    const cancel = () => {
      cancelled = true;
      // Mark task as cancelled in queue
      const index = this.queue.findIndex((t) => !t.cancelled);
      if (index !== -1) {
        this.queue[index].cancelled = true;
      }
    };

    return { promise, cancel };
  }

  private async processQueue(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    // Find next non-cancelled task
    let queueTask: QueueTask | undefined;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task && !task.cancelled) {
        queueTask = task;
        break;
      }
    }

    if (!queueTask) {
      return;
    }

    this.activeCount++;

    try {
      await queueTask.task();
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }
}

/**
 * Coordinates markdown render results to batch React state updates.
 *
 * Problem: When 10-15 MarkdownDiv instances complete async rendering,
 * each fires startTransition(() => setRenderedHtml(result)) from a
 * separate Promise microtask. React 18 does NOT batch across microtasks,
 * causing 10-15 separate React commits (30-40ms each = 300-600ms total).
 *
 * Solution: Collect completed results and deliver them ALL in a single
 * startTransition callback via queueMicrotask. React batches all setState
 * calls within one startTransition into ONE commit.
 */
class MarkdownRenderCoordinator {
  private completedResults: Map<string, string> = new Map();
  private pendingCallbacks: Map<string, (html: string) => void> = new Map();
  private flushScheduled = false;
  private queue: MarkdownRenderQueue;

  constructor(maxConcurrent: number = 10) {
    this.queue = new MarkdownRenderQueue(maxConcurrent);
  }

  enqueue(
    cacheKey: string,
    task: () => Promise<string>,
    onComplete: (html: string) => void,
  ): { cancel: () => void } {
    this.pendingCallbacks.set(cacheKey, onComplete);

    const { promise, cancel } = this.queue.enqueue(task);

    promise
      .then((result) => {
        this.completedResults.set(cacheKey, result);
        this.scheduleFlush();
      })
      .catch((error) => {
        this.pendingCallbacks.delete(cacheKey);
        console.error("Markdown rendering error:", error);
      });

    return {
      cancel: () => {
        cancel();
        this.pendingCallbacks.delete(cacheKey);
        this.completedResults.delete(cacheKey);
      },
    };
  }

  private scheduleFlush() {
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  private flush() {
    this.flushScheduled = false;
    const batch = new Map(this.completedResults);
    this.completedResults.clear();

    if (batch.size === 0) return;

    startTransition(() => {
      for (const [key, html] of batch) {
        const callback = this.pendingCallbacks.get(key);
        if (callback) {
          callback(html);
          this.pendingCallbacks.delete(key);
        }
      }
    });
  }
}

// Shared rendering coordinator — batches markdown render completions
// into single React commits to avoid cascading re-renders
const renderCoordinator = new MarkdownRenderCoordinator(10);
