import { supabaseAdmin } from "./supabaseAdmin";

export async function handleIncomingMessage(whatsappManager: any, userId: string, jid: string, text: string, isButton: boolean = false) {
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) return;

    const { data: automations, error } = await supabaseAdmin
      .from("automations")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true);

    if (error) throw error;

    if (!automations || automations.length === 0) {
      console.log(`No active automations found for user ${userId}`);
      if (isButton) {
        await whatsappManager.sendMessage(userId, jid, "Opção ainda não configurada");
      }
      return;
    }

    const normalizedText = text.trim().toLowerCase();
    console.log(`Checking ${automations.length} automations for user ${userId} with text: "${normalizedText}"`);

    let triggered = false;
    for (const automation of automations) {
      let shouldTrigger = false;

      if (automation.trigger === "keyword") {
        const keywordStr = automation.keyword || "";
        const keywords = keywordStr.toLowerCase().split(",").map((k: string) => k.trim()).filter(Boolean);
        // Fuzzy matching: check if message contains any of the keywords
        if (keywords.some((k: string) => normalizedText.includes(k))) {
          shouldTrigger = true;
        }
      }

      if (shouldTrigger) {
        triggered = true;
        console.log(`Triggering automation "${automation.name}" for user ${userId} with delay ${automation.delay || 0}s`);
        
        // Wait for the configured delay (plus a small random jitter for human-like behavior)
        const delayMs = (automation.delay || 0) * 1000;
        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs + (Math.random() * 1000)));
        }

        // Simulate typing or recording
        const presenceType = automation.media_type === "audio" ? "recording" : "composing";
        await whatsappManager.sendPresenceUpdate(userId, jid, presenceType);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Base typing time
        await whatsappManager.sendPresenceUpdate(userId, jid, "paused");

        if (automation.response_type === "buttons") {
          const buttonsData = JSON.parse(automation.buttons_json);
          await whatsappManager.sendButtonsMessage(userId, jid, buttonsData.text, buttonsData.buttons);
          await whatsappManager.log(userId, "success", `Bot "${automation.name}" (Menu) disparado para ${jid}`, { trigger: normalizedText, buttons: buttonsData });
        } else {
          await whatsappManager.sendMessage(userId, jid, automation.response, automation.media_url, automation.media_type);
          await whatsappManager.log(userId, "success", `Bot "${automation.name}" disparado para ${jid}`, { trigger: normalizedText, response: automation.response, media_type: automation.media_type });
        }
        
        // Log the automated message to messages table
        try {
          // Find contact id first
          const { data: contact } = await supabaseAdmin
            .from("contacts")
            .select("id")
            .eq("user_id", userId)
            .eq("phone", jid.split("@")[0])
            .maybeSingle();

          await supabaseAdmin.from("messages").insert({
            user_id: userId,
            contact_id: contact?.id || "automated",
            text: automation.response_type === "buttons" ? JSON.parse(automation.buttons_json).text : automation.response,
            type: "outbound",
            timestamp: new Date().toISOString(),
            is_automated: true,
            automation_id: automation.id
          });
        } catch (e) {
          console.error("Error logging automated message to database:", e);
        }
      }
    }

    if (!triggered && isButton) {
      await whatsappManager.sendMessage(userId, jid, "Opção ainda não configurada");
    }
  } catch (err) {
    console.error("Automation handler error:", err);
  }
}
