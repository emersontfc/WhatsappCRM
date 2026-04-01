import { supabaseAdmin } from "./supabaseAdmin";

export async function handleIncomingMessage(whatsappManager: any, userId: string, jid: string, text: string, isButton: boolean = false) {
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) return;

    const normalizedText = text.trim().toLowerCase();
    let triggered = false;

    // 1. Check automations
    const { data: automations, error } = await supabaseAdmin
      .from("automations")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true);

    if (error) throw error;

    if (automations) {
      for (const automation of automations) {
        let shouldTrigger = false;

        if (automation.trigger === "keyword") {
          const keywordStr = automation.keyword || "";
          const keywords = keywordStr.toLowerCase().split(",").map((k: string) => k.trim()).filter(Boolean);
          if (keywords.some((k: string) => normalizedText.includes(k))) {
            shouldTrigger = true;
          }
        }

        if (shouldTrigger) {
          triggered = true;
          const delayMs = (automation.delay || 0) * 1000;
          if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs + (Math.random() * 1000)));
          }

          const presenceType = automation.media_type === "audio" ? "recording" : "composing";
          await whatsappManager.sendPresenceUpdate(userId, jid, presenceType);
          await new Promise(resolve => setTimeout(resolve, 2000));
          await whatsappManager.sendPresenceUpdate(userId, jid, "paused");

          if (automation.response_type === "buttons") {
            const buttonsData = JSON.parse(automation.buttons_json);
            await whatsappManager.sendButtonsMessage(userId, jid, buttonsData.text, buttonsData.buttons);
            await whatsappManager.log(userId, "success", `Bot "${automation.name}" (Menu) disparado para ${jid}`, { trigger: normalizedText, buttons: buttonsData });
          } else {
            await whatsappManager.sendMessage(userId, jid, automation.response, automation.media_url, automation.media_type);
            await whatsappManager.log(userId, "success", `Bot "${automation.name}" disparado para ${jid}`, { trigger: normalizedText, response: automation.response, media_type: automation.media_type });
          }
          
          try {
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
    }

    // 2. Check quick_replies if not already triggered by automation
    if (!triggered) {
      const { data: quickReplies, error: qrError } = await supabaseAdmin
        .from("quick_reply")
        .select("*")
        .eq("user_id", userId);
        
      if (qrError) console.error("Error fetching quick replies:", qrError);
      
      if (quickReplies) {
        for (const qr of quickReplies) {
          let match = false;
          const trigger = qr.trigger.toLowerCase();
          
          if (qr.match_type === 'exact') {
            match = normalizedText === trigger;
          } else { // Default to 'contains'
            match = normalizedText.includes(trigger);
          }
          
          if (match) {
            triggered = true;
            await whatsappManager.sendMessage(userId, jid, qr.response_text);
            await whatsappManager.log(userId, "success", `Quick reply "${qr.trigger}" disparado para ${jid}`);
            
            // Log to messages table
            try {
              const { data: contact } = await supabaseAdmin
                .from("contacts")
                .select("id")
                .eq("user_id", userId)
                .eq("phone", jid.split("@")[0])
                .maybeSingle();

              await supabaseAdmin.from("messages").insert({
                user_id: userId,
                contact_id: contact?.id || "automated",
                text: qr.response_text,
                type: "outbound",
                timestamp: new Date().toISOString(),
                is_automated: true
              });
            } catch (e) {
              console.error("Error logging quick reply message to database:", e);
            }
            break; // Stop after first match
          }
        }
      }
    }

    if (!triggered && isButton) {
      await whatsappManager.sendMessage(userId, jid, "Opção ainda não configurada");
    }

    return triggered;
  } catch (err) {
    console.error("Automation handler error:", err);
    return false;
  }
}
