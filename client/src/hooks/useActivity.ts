/**
 * Anonymous first-party activity reporter. Fire-and-forget: activity logging
 * must never block or break the visitor experience.
 */
import { trpc } from "@/lib/trpc";
import { getVisitorId } from "@/lib/visitor";

export type ActivityKind = "favorite" | "unfavorite" | "ai_search" | "convince_quiz" | "city_finder";

export function useActivity() {
  const log = trpc.activity.log.useMutation();
  return (kind: ActivityKind, data: Record<string, unknown>) => {
    const visitorId = getVisitorId();
    if (!visitorId) return; // storage blocked — tracking silently off
    log.mutate({ visitorId, kind, data }, { onError: () => undefined });
  };
}
