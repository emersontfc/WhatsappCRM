type ChatTextSource = {
  msg_id?: string | null;
  text?: string | null;
  type?: string | null;
  media_url?: string | null;
  media_type?: string | null;
};

export function isQuotableChatText(message: ChatTextSource) {
  return (message.type === "inbound" || message.type === "outbound") &&
    Boolean(message.msg_id && /^[a-z0-9_.:-]{1,160}$/i.test(message.msg_id) && !message.msg_id.startsWith("gen-") &&
      message.text?.trim() && !message.media_url && !message.media_type);
}
