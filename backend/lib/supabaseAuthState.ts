import { 
  AuthenticationState, 
  AuthenticationCreds, 
  SignalDataTypeMap, 
  initAuthCreds, 
  BufferJSON, 
  proto 
} from "@whiskeysockets/baileys";
import { supabaseAdmin } from "../supabaseAdmin";

export const useSupabaseAuthState = async (userId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
  
  const writeData = async (data: any, category: string, keyId?: string) => {
    const payload = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
    
    const { error } = await supabaseAdmin
      .from("whatsapp_sessions")
      .upsert({
        user_id: userId,
        category,
        key_id: keyId || "default",
        data: payload,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id,category,key_id" });

    if (error) {
      console.error(`[SupabaseAuthState] Error writing ${category}:${keyId}:`, error.message);
    }
  };

  const readData = async (category: string, keyId?: string) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("whatsapp_sessions")
        .select("data")
        .eq("user_id", userId)
        .eq("category", category)
        .eq("key_id", keyId || "default")
        .maybeSingle();

      if (error) {
        console.error(`[SupabaseAuthState] Error reading ${category}:${keyId}:`, error.message);
        return null;
      }

      return data ? JSON.parse(JSON.stringify(data.data), BufferJSON.reviver) : null;
    } catch (err) {
      console.error(`[SupabaseAuthState] Error parsing ${category}:${keyId}:`, err);
      return null;
    }
  };

  const removeData = async (category: string, keyId?: string) => {
    const { error } = await supabaseAdmin
      .from("whatsapp_sessions")
      .delete()
      .eq("user_id", userId)
      .eq("category", category)
      .eq("key_id", keyId || "default");

    if (error) {
      console.error(`[SupabaseAuthState] Error removing ${category}:${keyId}:`, error.message);
    }
  };

  const creds: AuthenticationCreds = await readData("creds") || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(type, id);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category as keyof SignalDataTypeMap]) {
              const value = data[category as keyof SignalDataTypeMap]![id];
              if (value) {
                tasks.push(writeData(value, category, id));
              } else {
                tasks.push(removeData(category, id));
              }
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, "creds"),
  };
};
