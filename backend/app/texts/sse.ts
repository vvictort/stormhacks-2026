import type { Request, Response } from "express";
import type { TextThread } from "../shared/types.ts";

// Server-sent events for simulated text threads.
// Events: `message` (TextMessage, SSE id = message id), `typing` ({ on }), `ended` ({ outcome, reason }).

const subscribers = new Map<string, Set<Response>>();

function write(res: Response, event: string, data: unknown, id?: string) {
  res.write(
    `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

/**
 * Opens the stream, replays messages (only those after `Last-Event-ID` on reconnect),
 * then delivers live events. Clients should close the EventSource on `ended`.
 */
export function subscribe(thread: TextThread, req: Request, res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write("retry: 3000\n\n");

  const lastEventId = req.get("last-event-id");
  const start = lastEventId
    ? thread.messages.findIndex((m) => m.id === lastEventId) + 1
    : 0;
  for (const m of thread.messages.slice(start)) write(res, "message", m, m.id);
  if (thread.status === "ended")
    write(res, "ended", { outcome: thread.outcome, reason: thread.endReason });

  let set = subscribers.get(thread.id);
  if (!set) subscribers.set(thread.id, (set = new Set()));
  set.add(res);
  req.on("close", () => {
    set.delete(res);
    if (set.size === 0) subscribers.delete(thread.id);
  });
}

export function publish(
  threadId: string,
  event: "message" | "typing" | "ended",
  data: unknown,
  id?: string,
) {
  for (const res of subscribers.get(threadId) ?? [])
    write(res, event, data, id);
}

/** Ends every open stream (shutdown). */
export function closeAll() {
  for (const set of subscribers.values()) for (const res of set) res.end();
}

// Comment heartbeat keeps idle connections open through proxies.
setInterval(() => {
  for (const set of subscribers.values())
    for (const res of set) res.write(": ping\n\n");
}, 25_000).unref();
