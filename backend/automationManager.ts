import { supabaseAdmin } from "./supabaseAdmin.ts";

// In-memory state for smart menus
// Key: userId:jid, Value: { menuId: string, options: any[], timestamp: number }
const menuStateCache = new Map<string, { menuId: string, options: any[], timestamp: number }>();

export async function handleIncomingMessage(whatsappManager: any, userId: string, jid: string, text: string, isButton: boolean = false) {
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) return false;

    // 0. Capture Lead (runs before any automation)
    try {
      const phone = jid.split("@")[0];
      await supabaseAdmin.from("leads").upsert({
        user_id: userId,
        phone,
        last_message: text,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id, phone" });
      console.log(`[Automation] Lead captured for ${phone}`);
    } catch (e) {
      console.error("[Automation] Error capturing lead:", e);
    }

    const normalizedText = text.trim().toLowerCase();
    let triggered = false;
    
    console.log(`[Automation] Checking automations for ${userId}, text: "${normalizedText}"`);

    // 0. Check if user is responding to a menu
    const stateKey = `${userId}:${jid}`;
    const activeMenuState = menuStateCache.get(stateKey);
    
    if (activeMenuState && (Date.now() - activeMenuState.timestamp < 3600000)) { // 1 hour expiration
      console.log(`[Automation] User is in an active menu state. Checking options...`);
      const selectedOption = activeMenuState.options.find((opt: any) => opt.key.toLowerCase() === normalizedText);
      
      if (selectedOption) {
        console.log(`[Automation] Matched menu option: ${selectedOption.key}`);
        triggered = true;
        
        // Simulate typing
        const presenceType = (selectedOption.response_type === "audio" && selectedOption.media_url) ? "recording" : "composing";
        await whatsappManager.sendPresenceUpdate(userId, jid, presenceType);
        await new Promise(resolve => setTimeout(resolve, 1500));
        await whatsappManager.sendPresenceUpdate(userId, jid, "paused");

        // Send response
        await whatsappManager.sendMessage(userId, jid, selectedOption.response, selectedOption.media_url, selectedOption.response_type);
        await whatsappManager.log(userId, "success", `Opção de menu "${selectedOption.label}" disparada para ${jid}`);
        
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
            text: selectedOption.response,
            type: "outbound",
            timestamp: new Date().toISOString(),
            is_automated: true
          });
        } catch (e) {
          console.error("Error logging menu response to database:", e);
        }
        
        // We don't clear the state so they can choose another option if they want,
        // or we could clear it. Let's clear it to avoid getting stuck.
        menuStateCache.delete(stateKey);
        return true; // Stop processing other automations
      }
    }

    // 1. Check automations
    const { data: automations, error } = await supabaseAdmin
      .from("automations")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true);

    if (error) {
      console.error("[Automation] Error fetching automations:", error);
      throw error;
    }

    if (automations && automations.length > 0) {
      console.log(`[Automation] Found ${automations.length} active automations`);
      for (const automation of automations) {
        let shouldTrigger = false;

        if (automation.trigger === "keyword") {
          const keywordStr = automation.keyword || "";
          const keywords = keywordStr.toLowerCase().split(",").map((k: string) => k.trim()).filter(Boolean);
          if (keywords.some((k: string) => normalizedText.includes(k))) {
            shouldTrigger = true;
            console.log(`[Automation] Matched keyword in automation: ${automation.name}`);
          }
        }

        if (shouldTrigger) {
          triggered = true;
          const delayMs = (automation.delay || 0) * 1000;
          if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs + (Math.random() * 1000)));
          }

          const presenceType = (automation.response_type === "audio" && automation.media_url) ? "recording" : "composing";
          await whatsappManager.sendPresenceUpdate(userId, jid, presenceType);
          await new Promise(resolve => setTimeout(resolve, 2000));
          await whatsappManager.sendPresenceUpdate(userId, jid, "paused");

          if (automation.response_type === "menu" && automation.smart_menu_id) {
            const { data: menu, error: menuError } = await supabaseAdmin
              .from("smart_menus")
              .select("*")
              .eq("id", automation.smart_menu_id)
              .single();

            if (menu && !menuError) {
              await whatsappManager.sendMenu(userId, jid, menu);
              await whatsappManager.log(userId, "success", `Menu Inteligente "${menu.name}" disparado para ${jid}`, { trigger: normalizedText });
              
              // Save menu state so we can handle the user's reply
              if (menu.options && Array.isArray(menu.options)) {
                menuStateCache.set(stateKey, {
                  menuId: menu.id,
                  options: menu.options,
                  timestamp: Date.now()
                });
                console.log(`[Automation] Saved menu state for ${stateKey}`);
              }
            } else {
              console.error("Error fetching menu for automation:", menuError);
              await whatsappManager.sendMessage(userId, jid, "Desculpe, houve um erro ao carregar o menu.");
            }
          } else {
            await whatsappManager.sendMessage(userId, jid, automation.response, automation.media_url, automation.media_type, undefined, automation.media_mimetype, automation.media_filename);
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
              text: automation.response_type === "menu" ? "Menu Inteligente Enviado" : automation.response,
              type: "outbound",
              timestamp: new Date().toISOString(),
              is_automated: true,
              automation_id: automation.id
            });
          } catch (e) {
            console.error("Error logging automated message to database:", e);
          }
          
          break; // Stop processing other automations if one triggered
        }
      }
    } else {
      console.log(`[Automation] No active automations found for ${userId}`);
    }

    // 2. Check quick_replies if not already triggered by automation
    if (!triggered) {
      console.log(`[Automation] Checking quick replies for ${userId}`);
      const { data: quickReplies, error: qrError } = await supabaseAdmin
        .from("quick_reply")
        .select("*")
        .eq("user_id", userId);
        
      if (qrError) console.error("Error fetching quick replies:", qrError);
      
      if (quickReplies && quickReplies.length > 0) {
        for (const qr of quickReplies) {
          let match = false;
          const trigger = qr.trigger.toLowerCase();
          
          if (qr.match_type === 'exact') {
            match = normalizedText === trigger;
          } else { // Default to 'contains'
            match = normalizedText.includes(trigger);
          }
          
          if (match) {
            console.log(`[Automation] Matched quick reply: ${qr.trigger}`);
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
      console.log(`[Automation] Button clicked but no match found`);
      await whatsappManager.sendMessage(userId, jid, "Opção ainda não configurada");
    }

    return triggered;
  } catch (err) {
    console.error("Automation handler error:", err);
    return false;
  }
}
