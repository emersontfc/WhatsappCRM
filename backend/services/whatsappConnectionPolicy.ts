import { DisconnectReason, fetchLatestBaileysVersion, fetchLatestWaWebVersion, type WAVersion } from "@whiskeysockets/baileys";

let cached: { version: WAVersion | undefined; until: number } | undefined;
let pending: Promise<WAVersion | undefined> | undefined;

async function lookupVersion() {
  for (const probe of [fetchLatestBaileysVersion, fetchLatestWaWebVersion]) {
    try {
      const { version, isLatest } = await probe({ signal: AbortSignal.timeout(2_500) });
      if (isLatest && version.length === 3 && version.every((part) => Number.isSafeInteger(part) && part >= 0)) return version;
    } catch {
      // Try the other supported lookup while keeping the pinned Baileys default available.
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
