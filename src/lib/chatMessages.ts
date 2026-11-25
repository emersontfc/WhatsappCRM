import type { Message } from "../types";

export function mergeMessage(current: Message[], incoming: Message): Message[] {
  const existing = current.findIndex((message) =>
    message.id === incoming.id || Boolean(incoming.msg_id && message.msg_id === incoming.msg_id));
  if (existing >= 0 && current[existing].id === incoming.id) return current;
  const next = current.filter((_, index) => index !== existing);
  const position = next.findIndex((message) => message.id.startsWith("temp-") || compareMessagePosition(message, incoming) > 0);
  next.splice(position < 0 ? next.length : position, 0, incoming);
  return next;
}

function compareMessagePosition(left: Message, right: Message) {
  if (!left.timestamp || !right.timestamp) {
    if (left.timestamp !== right.timestamp) return left.timestamp ? 1 : -1;
    return left.id.localeCompare(right.id);
  }
  const byMillisecond = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  if (byMillisecond) return byMillisecond;
  const subMilliseconds = (timestamp: string) => (timestamp.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6);
  return subMilliseconds(left.timestamp).localeCompare(subMilliseconds(right.timestamp)) || left.id.localeCompare(right.id);
}

export const liveChatReconcileMs = 60_000;
export const degradedChatReconcileMs = 4_000;
const chatEventDelayMs = 250;

export function makeChatRefresh(
  refresh: (reconcileHead: boolean) => Promise<void>,
  isVisible: () => boolean,
  onError: (error: unknown) => void
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scheduledFor = 0;
  let connected = false;
  let stopped = false;
  let running = false;
  let rerun = false;
  let needsHead = false;
  let lastHead: number | undefined;

  function schedule(ms: number, coalesce = false) {
    const due = Date.now() + ms;
    if (coalesce && timer && scheduledFor <= due) return;
    clearTimeout(timer);
    timer = undefined;
    if (stopped || !isVisible()) return;
    scheduledFor = due;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, ms);
  }

  async function run() {
    if (stopped || !isVisible()) return;
    running = true;
    const reconcileHead = needsHead || lastHead === undefined || Date.now() - lastHead >= liveChatReconcileMs;
    needsHead = false;
    try {
      await refresh(reconcileHead);
      if (reconcileHead) lastHead = Date.now();
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        schedule(chatEventDelayMs);
      } else {
        schedule(connected ? liveChatReconcileMs : degradedChatReconcileMs);
      }
    }
  }

  function request(ms: number, reconcileHead = false) {
    if (stopped || !isVisible()) return;
    needsHead ||= reconcileHead;
    if (running) rerun = true;
    else schedule(ms, true);
  }

  return {
    received: () => request(chatEventDelayMs),
    recover: () => request(0, true),
    connection(ready: boolean) {
      if (connected !== ready) {
        connected = ready;
        request(0, true);
      }
    },
    suspend() {
      clearTimeout(timer);
      timer = undefined;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    }
  };
}
