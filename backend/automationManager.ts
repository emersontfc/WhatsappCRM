import { supabaseAdmin } from "./supabaseAdmin.ts";
import { normalizeContactPhone } from "../shared/contactPhone.ts";

// In-memory state for smart menus
// Key: userId:jid, Value: { menuId: string, options: any[], timestamp: number }
const menuStateCache = new Map<string, { menuId: string, options: any[], timestamp: number }>();

async function captureInboundLead(userId: string, contactId: string, jid: string, text: string) {
  const incomingPhone = /@(?:s\.whatsapp\.net|c\.us)$/i.test(jid) ? normalizeContactPhone(jid) : null;
  const incomingLid = /^(\d{5,20})(?::\d+)?@lid$/i.exec(jid)?.[1];
  if (!incomingPhone && !incomingLid) return;

  try {
    const signal = AbortSignal.timeout(5_000);
    const { data: contact, error } = await supabaseAdmin.from("contacts")
      .select("id, name, phone, lid").eq("user_id", userId).eq("id", contactId)
      .abortSignal(signal).maybeSingle();
    if (error) throw error;
    if (!contact) return;
    const phone = normalizeContactPhone(contact.phone);
    const storedLid = contact.lid?.split(/[:@]/)[0];
    const matchesSender = incomingPhone ? phone === incomingPhone : incomingLid === storedLid;
    if (!phone || !matchesSender || phone === normalizeContactPhone(storedLid)) return;

    const { data: leadId, error: captureError } = await supabaseAdmin.rpc("agentx_capture_sales_lead", {
      p_user: userId, p_phone: phone, p_contact: contact.id,
      p_name: contact.name, p_activity: "inbound", p_message: text
    }).abortSignal(signal);
    if (captureError || !leadId) {
      console.warn("[Automation] Lead capture unavailable:", captureError?.code || "no_result");
    }
  } catch (error) {
    console.warn("[Automation] Lead capture unavailable:", (error as { code?: string })?.code || "request_failed");
  }
}

export async function handleIncomingMessage(
  whatsappManager: any, userId: string, jid: string, text: string, isButton = false, savedContactId?: string | null
) {
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) return false;

    if (savedContactId) await captureInboundLead(userId, savedContactId, jid, text);

    const normalizedText = text.trim().toLowerCase();
    let triggered = false;
    
    console.log(`[Automation] Checking automations for user ${userId}`);

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

        // Send response (automatically persisted and deduplicated by whatsappManager)
        await whatsappManager.sendMessage(userId, jid, selectedOption.response, selectedOption.media_url, selectedOption.response_type);
        await whatsappManager.log(userId, "success", `Opção de menu "${selectedOption.label}" disparada para ${jid}`);
        
        // Clear state to avoid getting stuck
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
          const keywords = keywordStr
            .toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .split(",")
            .map((k: string) => k.trim())
            .filter(Boolean);
          const cleanText = normalizedText.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (keywords.some((k: string) => cleanText.includes(k))) {
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
            const finalMediaType = automation.media_type || (automation.response_type === "audio" ? "audio" : undefined);
            await whatsappManager.sendMessage(userId, jid, automation.response, automation.media_url, finalMediaType, undefined, automation.media_mimetype, automation.media_filename);
            await whatsappManager.log(userId, "success", `Bot "${automation.name}" disparado para ${jid}`, { trigger: normalizedText, response: automation.response, media_type: finalMediaType });
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
