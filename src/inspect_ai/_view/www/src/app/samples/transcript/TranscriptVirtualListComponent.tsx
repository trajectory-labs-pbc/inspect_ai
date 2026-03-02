import clsx from "clsx";
import {
  CSSProperties,
  FC,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { ToolEvent } from "../../../@types/log";
import { EventNodeContext, RenderedEventNode } from "./TranscriptVirtualList";
import { EventNode } from "./types";
import { findNextVisualBrowserAction } from "../chat/tools/browserActionUtils";

import { VirtuosoHandle } from "react-virtuoso";
import { LiveVirtualList } from "../../../components/LiveVirtualList";
import { useStore } from "../../../state/store";
import styles from "./TranscriptVirtualListComponent.module.css";
import { eventSearchText } from "./eventSearchText";

interface TranscriptVirtualListComponentProps {
  id: string;
  listHandle: RefObject<VirtuosoHandle | null>;
  eventNodes: EventNode[];
  initialEventId?: string | null;
  offsetTop?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  running?: boolean;
  className?: string | string[];
  turnMap?: Map<string, { turnNumber: number; totalTurns: number }>;
}

/**
 * Renders the Transcript component.
 */
export const TranscriptVirtualListComponent: FC<
  TranscriptVirtualListComponentProps
> = ({
  id,
  listHandle,
  eventNodes,
  scrollRef,
  running,
  initialEventId,
  offsetTop,
  className,
  turnMap,
}) => {
  const useVirtualization = running || eventNodes.length > 100;
  const setNativeFind = useStore((state) => state.appActions.setNativeFind);
  useEffect(() => {
    setNativeFind(!useVirtualization);
  }, [setNativeFind, useVirtualization]);

  const initialEventIndex = useMemo(() => {
    if (initialEventId === null || initialEventId === undefined) {
      return undefined;
    }
    const result = eventNodes.findIndex((event) => {
      return event.id === initialEventId;
    });
    return result === -1 ? undefined : result;
  }, [initialEventId, eventNodes]);

  const hasToolEventsAtCurrentDepth = useCallback(
    (startIndex: number) => {
      // Walk backwards from this index to see if we see any tool events
      // at this depth, prior to this event
      for (let i = startIndex; i >= 0; i--) {
        const node = eventNodes[i];
        if (node.event.event === "tool") {
          return true;
        }
        if (node.depth < eventNodes[startIndex].depth) {
          return false;
        }
      }
      return false;
    },
    [eventNodes],
  );

  const nonVirtualGridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!useVirtualization && initialEventId) {
      const row = nonVirtualGridRef.current?.querySelector(
        `[id="${initialEventId}"]`,
      );
      row?.scrollIntoView({ block: "start" });
    }
  }, [initialEventId, useVirtualization]);

  // Pre-compute context objects for all event nodes to maintain stable references
  const contextMap = useMemo(() => {
    const map = new Map<string, EventNodeContext>();
    for (let i = 0; i < eventNodes.length; i++) {
      const node = eventNodes[i];
      const hasToolEvents = hasToolEventsAtCurrentDepth(i);
      const turnInfo = turnMap?.get(node.id);
      const nextVisualAction = computeNextVisualAction(eventNodes, i);
      map.set(node.id, { hasToolEvents, turnInfo, nextVisualAction });
    }
    return map;
  }, [eventNodes, hasToolEventsAtCurrentDepth, turnMap]);

  const renderRow = useCallback(
    (index: number, item: EventNode, style?: CSSProperties) => {
      const paddingClass = index === 0 ? styles.first : undefined;

      const previousIndex = index - 1;
      const nextIndex = index + 1;
      const previous =
        previousIndex > 0 && previousIndex <= eventNodes.length
          ? eventNodes[previousIndex]
          : undefined;
      const next =
        nextIndex < eventNodes.length ? eventNodes[nextIndex] : undefined;
      const attached =
        item.event.event === "tool" &&
        (previous?.event.event === "tool" || previous?.event.event === "model");

      const attachedParent =
        item.event.event === "model" && next?.event.event === "tool";
      const attachedClass = attached ? styles.attached : undefined;
      const attachedChildClass = attached ? styles.attachedChild : undefined;
      const attachedParentClass = attachedParent
        ? styles.attachedParent
        : undefined;

      const context = contextMap.get(item.id);

      return (
        <div
          id={item.id}
          key={item.id}
          className={clsx(styles.node, paddingClass, attachedClass)}
          style={{
            ...style,
            paddingLeft: `${item.depth <= 1 ? item.depth * 0.7 : (0.7 + item.depth - 1) * 1}em`,
            paddingRight: `${item.depth === 0 ? undefined : ".7em"} `,
          }}
        >
          <RenderedEventNode
            node={item}
            next={next}
            className={clsx(attachedParentClass, attachedChildClass)}
            context={context}
          />
        </div>
      );
    },
    [eventNodes, contextMap],
  );

  if (useVirtualization) {
    return (
      <LiveVirtualList<EventNode>
        listHandle={listHandle}
        className={className}
        id={id}
        scrollRef={scrollRef}
        data={eventNodes}
        initialTopMostItemIndex={initialEventIndex}
        offsetTop={offsetTop}
        renderRow={renderRow}
        live={running}
        itemSearchText={eventSearchText}
      />
    );
  } else {
    return (
      <div ref={nonVirtualGridRef}>
        {eventNodes.map((node, index) => {
          const row = renderRow(index, node, {
            scrollMarginTop: offsetTop,
          });
          return row;
        })}
      </div>
    );
  }
};

/**
 * For a screenshot tool event at the given index, walk forward through the
 * flat event list to find the next visual browser action (click/scroll/type).
 * The annotation shows what is ABOUT TO happen on this screen — the
 * coordinates refer to what's visible in THIS screenshot.
 *
 * The list interleaves model and tool events: model → tool → model → tool.
 * We skip non-tool events and non-visual browser actions (get_page_text, etc.)
 * that don't have coordinates, stopping at the next screenshot or visual action.
 */
function computeNextVisualAction(
  eventNodes: EventNode[],
  index: number,
): Record<string, unknown> | undefined {
  const node = eventNodes[index];
  if (node.event.event !== "tool") return undefined;

  const toolEvent = node.event as ToolEvent;
  const args = toolEvent.arguments as Record<string, unknown>;
  if (toolEvent.function !== "browser" || args?.action !== "screenshot") {
    return undefined;
  }

  // Walk forward. The list includes span_begin, sandbox, model events between
  // tool events. With ~7 sandbox events per tool span, we need up to ~20 steps
  // to reach the next visual tool event after a non-visual one.
  const browserArgs: Array<Record<string, unknown>> = [];
  for (let i = index + 1; i < eventNodes.length && i <= index + 30; i++) {
    const candidate = eventNodes[i];
    if (candidate.event.event !== "tool") continue; // skip model/span/sandbox events
    const candEvent = candidate.event as ToolEvent;
    if (candEvent.function !== "browser") break; // stop at non-browser tools
    browserArgs.push(candEvent.arguments as Record<string, unknown>);
  }

  return findNextVisualBrowserAction(browserArgs);
}
