import { DisconnectReason, fetchLatestBaileysVersion, fetchLatestWaWebVersion, type WAVersion } from "@whiskeysockets/baileys";

let cached: { version: WAVersion | undefined; until: number } | undefined;
let pending: Promise<WAVersion | undefined> | undefined;

async function lookupVersion() {
  for (const probe of [fetchLatestBaileysVersion, fetchLatestWaWebVersion]) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Some Baileys releases do not pass the supplied signal through to fetch.
      const deadline = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          resolve(undefined);
          controller.abort();
        }, 2_500);
      });
      const result = await Promise.race([probe({ signal: controller.signal }), deadline]);
      if (result?.isLatest && result.version.length === 3 &&
          result.version.every((part) => Number.isSafeInteger(part) && part >= 0)) return result.version;
    } catch {
      // Try the other supported lookup while keeping the pinned Baileys default available.
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

export function whatsappWebVersion() {
  if (cached && Date.now() < cached.until) return Promise.resolve(cached.version);
  if (!pending) {
    pending = lookupVersion().then((version) => {
      cached = { version: version ?? cached?.version, until: Date.now() + (version ? 3_600_000 : 60_000) };
      return cached.version;
    }).finally(() => { pending = undefined; });
  }
  return pending;
}

export function whatsappDisconnectAction(status?: number, reason = "") {
  if (status === DisconnectReason.connectionReplaced || /\bconflict\b/i.test(reason)) return "replaced";
  if (status === DisconnectReason.loggedOut) return "logged_out";
  if (status === DisconnectReason.restartRequired) return "restart";
  if (status === 405 || status === 429 || status === DisconnectReason.forbidden || status === DisconnectReason.multideviceMismatch) {
    return "review";
  }
  return "retry";
}
