import type { Message } from "../types";

export function mergeMessage(current: Message[], incoming: Message): Message[] {
  const existing = current.findIndex((message) =>
    message.id === incoming.id || Boolean(incoming.msg_id && message.msg_id === incoming.msg_id));
  if (existing >= 0 && current[existing].id === incoming.id) return current;
  const next = current.filter((_, index) => index !== existing);
  const position = next.findIndex((message) =>
    message.id.startsWith("temp-") || Date.parse(message.timestamp) > Date.parse(incoming.timestamp));
  next.splice(position < 0 ? next.length : position, 0, incoming);
  return next;
}
