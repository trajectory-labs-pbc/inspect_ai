import {
  ApprovalEvent,
  CompactionEvent,
  InfoEvent,
  LoggerEvent,
  ModelEvent,
  SampleLimitEvent,
  SandboxEvent,
  ScoreEvent,
  SpanBeginEvent,
  StepEvent,
  SubtaskEvent,
  ToolEvent,
} from "../../../../@types/log";
import {
  formatDateTime,
  formatNumber,
  formatTime,
} from "../../../../utils/format";
import { EventType } from "../types";

const sampleLimitTitles: Record<string, string> = {
  custom: "Custom Limit Exceeded",
  time: "Time Limit Exceeded",
  message: "Message Limit Exceeded",
  token: "Token Limit Exceeded",
  operator: "Operator Canceled",
  working: "Execution Time Limit Exceeded",
  cost: "Cost Limit Exceeded",
};

const approvalDecisionLabels: Record<string, string> = {
  approve: "Approved",
  reject: "Rejected",
  terminate: "Terminated",
  escalate: "Escalated",
  modify: "Modified",
};

/**
 * Returns the base title string for any event type.
 * Used by both event rendering components and search text extraction.
 */
export const eventTitle = (event: EventType): string => {
  switch (event.event) {
    case "model": {
      const e = event as ModelEvent;
      return e.role
        ? `Model Call (${e.role}): ${e.model}`
        : `Model Call: ${e.model}`;
    }
    case "tool": {
      const e = event as ToolEvent;
      return `Tool: ${e.view?.title || e.function}`;
    }
    case "error":
      return "Error";
    case "logger":
      return (event as LoggerEvent).message.level;
    case "info": {
      const e = event as InfoEvent;
      return "Info" + (e.source ? ": " + e.source : "");
    }
    case "compaction": {
      const e = event as CompactionEvent;
      const source = e.source && e.source !== "inspect" ? e.source : "";
      return "Compaction" + source;
    }
    case "step": {
      const e = event as StepEvent;
      return e.type ? `${e.type}: ${e.name}` : `Step: ${e.name}`;
    }
    case "subtask": {
      const e = event as SubtaskEvent;
      return e.type === "fork" ? `Fork: ${e.name}` : `Subtask: ${e.name}`;
    }
    case "span_begin": {
      const e = event as SpanBeginEvent;
      return e.type ? `${e.type}: ${e.name}` : `Step: ${e.name}`;
    }
    case "score":
      return (
        ((event as ScoreEvent).intermediate ? "Intermediate " : "") + "Score"
      );
    case "score_edit":
      return "Edit Score";
    case "sample_init":
      return "Sample";
    case "sample_limit":
      return (
        sampleLimitTitles[(event as SampleLimitEvent).type] ??
        (event as SampleLimitEvent).type
      );
    case "input":
      return "Input";
    case "approval":
      return (
        approvalDecisionLabels[(event as ApprovalEvent).decision] ??
        (event as ApprovalEvent).decision
      );
    case "sandbox":
      return `Sandbox: ${(event as SandboxEvent).action}`;
    default:
      return "";
  }
};

export const formatTiming = (timestamp: string, working_start?: number) => {
  if (working_start) {
    return `${formatDateTime(new Date(timestamp))}\n@ working time: ${formatTime(working_start)}`;
  } else {
    return formatDateTime(new Date(timestamp));
  }
};

export const formatTitle = (
  title: string,
  total_tokens?: number,
  working_start?: number | null,
) => {
  const subItems = [];
  if (total_tokens) {
    subItems.push(`${formatNumber(total_tokens)} tokens`);
  }
  if (working_start) {
    subItems.push(`${formatTime(working_start)}`);
  }
  const subtitle = subItems.length > 0 ? ` (${subItems.join(", ")})` : "";
  return `${title}${subtitle}`;
};
