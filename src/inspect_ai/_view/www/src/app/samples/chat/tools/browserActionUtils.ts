/**
 * Set of browser actions that produce visual annotations
 * (click cursors, scroll arrows, typed text badges).
 */
export const VISUAL_BROWSER_ACTIONS = new Set([
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "scroll",
  "type",
  "key",
]);

/**
 * Walk a sequence of browser tool argument records and return the first
 * one whose action is a visual annotation (click/scroll/type/key).
 *
 * Returns undefined if a screenshot or navigate boundary is hit first,
 * or if no visual action is found.
 */
export function findNextVisualBrowserAction(
  browserArgsList: Iterable<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  for (const args of browserArgsList) {
    const action = args?.action as string | undefined;
    if (action === "screenshot" || action === "navigate") return undefined;
    if (action && VISUAL_BROWSER_ACTIONS.has(action)) return args;
  }
  return undefined;
}
