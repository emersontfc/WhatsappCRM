import { 
  AuthenticationState, 
  AuthenticationCreds, 
  SignalDataTypeMap, 
  initAuthCreds, 
  BufferJSON,
  proto,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import pino from "pino";

import fs from "fs";
import path from "path";

const logger = pino({ level: "warn" });

const authStateCache = new Map<string, { creds: AuthenticationCreds; keys: any }>();

const SESSIONS_DIR = path.join(process.cwd(), "whatsapp_sessions_data");
if (!fs.existsSync(SESSIONS_DIR)) {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  } catch (e) {}
}

export const clearSupabaseAuthCache = (userId: string) => {
  authStateCache.delete(userId);
  const filePath = path.join(SESSIONS_DIR, `${userId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`[WhatsApp Auth] Deleted local session file for user ${userId}`);
    } catch (e) {}
  }
};

/**
 * Robust Baileys authentication state handler that persists credentials to local disk
 * AND synchronizes to Supabase for multi-environment durability.
 */
export const useSupabaseAuthState = async (userId: string) => {
  const filePath = path.join(SESSIONS_DIR, `${userId}.json`);
  let sessionData = authStateCache.get(userId);

  if (!sessionData) {
    // 1. Try to load from local disk first (fastest and most reliable)
    if (fs.existsSync(filePath)) {
      try {
        const rawContent = fs.readFileSync(filePath, "utf-8");
        if (rawContent && rawContent.trim()) {
          sessionData = JSON.parse(rawContent, BufferJSON.reviver);
          console.log(`[WhatsApp Auth] Successfully restored session from local disk for user ${userId}`);
        }
      } catch (err) {
        console.error(`[WhatsApp Auth] Error parsing local session file for ${userId}:`, err);
      }
    }

    // 2. If not found on disk, try Supabase
    if (!sessionData) {
      try {
        const { data: row } = await supabaseAdmin
          .from("whatsapp_sessions")
          .select("session_data")
          .eq("user_id", userId)
          .maybeSingle();

        if (row?.session_data) {
          sessionData = JSON.parse(JSON.stringify(row.session_data), BufferJSON.reviver);
          console.log(`[WhatsApp Auth] Successfully loaded session from Supabase for user ${userId}`);
          // Save backup copy to local disk
          fs.writeFileSync(filePath, JSON.stringify(sessionData, BufferJSON.replacer));
        }
      } catch (dbErr) {
        // Supabase table might not exist yet; will fall back to local disk
      }
    }

    // 3. If neither exists, initialize clean auth credentials
    if (!sessionData) {
      sessionData = { creds: initAuthCreds(), keys: {} };
    }

    authStateCache.set(userId, sessionData!);
  }

  const currentSessionData = sessionData!;
  let saveTimeout: NodeJS.Timeout | null = null;

  // Helper to save state to Disk AND Supabase
  const saveState = async (immediate = false) => {
    const performSave = async () => {
      try {
        // Stringify with Buffer replacer
        const jsonStr = JSON.stringify(currentSessionData, BufferJSON.replacer);

        // 1. Always write to local disk
        fs.writeFileSync(filePath, jsonStr);

        // 2. Attempt upsert to Supabase
        const payload = JSON.parse(jsonStr);
        await supabaseAdmin
          .from("whatsapp_sessions")
          .upsert({
            user_id: userId,
            session_data: payload,
            updated_at: new Date().toISOString()
          }, { onConflict: "user_id" });
      } catch (err: any) {
        // Silently handle if supabase table does not exist; disk is already saved
      }
    };

    if (immediate) {
      if (saveTimeout) clearTimeout(saveTimeout);
      await performSave();
    } else {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(performSave, 1500);
    }
  };

  const state: AuthenticationState = {
    creds: currentSessionData.creds,
    keys: makeCacheableSignalKeyStore({
      get: (type, ids) => {
        const data: any = {};
        for (const id of ids) {
          let value = currentSessionData.keys[type]?.[id];
          if (value) {
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
        }
        return data;
      },
      set: (data) => {
        for (const type in data) {
          if (!currentSessionData.keys[type]) currentSessionData.keys[type] = {};
          Object.assign(currentSessionData.keys[type], data[type]);
        }
        return saveState(false);
      }
    }, logger)
  };

  return {
    state,
    saveCreds: () => saveState(true)
  };
};
