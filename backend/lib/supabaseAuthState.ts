import { 
  AuthenticationState, 
  AuthenticationCreds, 
  SignalDataTypeMap, 
  initAuthCreds, 
  BufferJSON,
  proto
} from "@whiskeysockets/baileys";
import { supabaseAdmin } from "../supabaseAdmin.ts";

/**
 * Custom Baileys authentication state handler that persists everything in a single Supabase JSONB column.
 * This ensures session persistence on platforms like Render without local file storage.
 */
export const useSupabaseAuthState = async (userId: string) => {
  // Load session from Supabase
  const { data: row } = await supabaseAdmin
    .from("whatsapp_sessions")
    .select("session_data")
    .eq("user_id", userId)
    .maybeSingle();

  // Parse session data (reviving buffers)
  let sessionData: { creds: AuthenticationCreds; keys: any } = row?.session_data
    ? JSON.parse(JSON.stringify(row.session_data), BufferJSON.reviver)
    : { creds: initAuthCreds(), keys: {} };

  let saveTimeout: NodeJS.Timeout | null = null;

  // Helper to save state to Supabase
  const saveState = async (immediate = false) => {
    const performSave = async () => {
      try {
        // Stringify with replacer to handle buffers, then parse back to object for JSONB storage
        const payload = JSON.parse(JSON.stringify(sessionData, BufferJSON.replacer));
        
        await supabaseAdmin
          .from("whatsapp_sessions")
          .upsert({
            user_id: userId,
            session_data: payload,
            updated_at: new Date().toISOString()
          }, { onConflict: "user_id" });
      } catch (err) {
        console.error(`[WhatsApp] Error saving auth state for ${userId}:`, err);
      }
    };

    if (immediate) {
      if (saveTimeout) clearTimeout(saveTimeout);
      await performSave();
    } else {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(performSave, 2000); // Debounce key saves
    }
  };

  const state: AuthenticationState = {
    creds: sessionData.creds,
    keys: {
      get: (type, ids) => {
        const data: any = {};
        for (const id of ids) {
          let value = sessionData.keys[type]?.[id];
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
          if (!sessionData.keys[type]) sessionData.keys[type] = {};
          Object.assign(sessionData.keys[type], data[type]);
        }
        return saveState(false);
      }
    }
  };

  return {
    state,
    saveCreds: () => saveState(true)
  };
};
