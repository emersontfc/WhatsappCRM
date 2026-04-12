import { supabaseAdmin } from "./supabaseAdmin.ts";
import { whatsappManager } from "./whatsappManager.ts";

export function startScheduler() {
  console.log("Message scheduler started.");
  
  let isRunning = false;

  const isSchemaError = (err: any) => 
    err?.code === "42P01" || 
    err?.code === "PGRST204" || 
    err?.code === "PGRST205" || 
    err?.message?.includes("does not exist") || 
    err?.message?.includes("schema cache");

  setInterval(async () => {
    if (isRunning) {
      console.log("Scheduler is already running, skipping this tick.");
      return;
    }
    
    isRunning = true;
    try {
      // Keep-alive ping
      const port = process.env.PORT || 3000;
      await fetch(`http://localhost:${port}/api/health`).catch(() => {});

      const now = new Date();
      const nowISO = now.toISOString();
      
      console.log(`[Scheduler] Checking for pending tasks at ${nowISO} (Local: ${now.toLocaleString()})`);

      // 1. Process Scheduled Messages
      const { data: pendingMessages, error } = await supabaseAdmin
        .from("scheduled_messages")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_at", nowISO)
        .limit(10);
      
      if (error && !isSchemaError(error)) {
        console.error("[Scheduler] Error fetching scheduled_messages:", error);
      }

      // 2. Process Scheduled Status (Stories)
      const { data: pendingStatus, error: statusError } = await supabaseAdmin
        .from("scheduled_status")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_at", nowISO)
        .limit(10);

      if (statusError && !isSchemaError(statusError)) {
        console.error("[Scheduler] Error fetching scheduled_status:", statusError);
      }

      if (pendingStatus && pendingStatus.length > 0) {
        console.log(`[Scheduler] Found ${pendingStatus.length} pending status updates.`);
        for (const statusMsg of pendingStatus) {
          try {
            console.log(`[Scheduler] Posting status ${statusMsg.id} for user ${statusMsg.user_id}`);
            const result = await whatsappManager.sendMessage(
              statusMsg.user_id,
              "status@broadcast",
              statusMsg.caption || "",
              statusMsg.media_url,
              statusMsg.media_type
            );

            console.log(`[Scheduler] Status ${statusMsg.id} posted successfully:`, result?.key?.id || "OK");

            await supabaseAdmin
              .from("scheduled_status")
              .update({ status: "sent" })
              .eq("id", statusMsg.id);
          } catch (err: any) {
            console.error(`[Scheduler] Failed to post status ${statusMsg.id}:`, err.message);
            await supabaseAdmin
              .from("scheduled_status")
              .update({ 
                status: "failed",
                error: err.message || "Unknown error"
              })
              .eq("id", statusMsg.id);
          }
        }
      }
      
      // 3. Process Reminders
      const { data: pendingReminders, error: reminderError } = await supabaseAdmin
        .from("reminders")
        .select("*")
        .eq("sent", false)
        .lte("scheduled_at", nowISO)
        .limit(10);

      if (reminderError && !isSchemaError(reminderError)) {
        console.error("[Scheduler] Error fetching reminders:", reminderError);
      }

      if (pendingReminders && pendingReminders.length > 0) {
        console.log(`[Scheduler] Found ${pendingReminders.length} pending reminders.`);
        for (const reminder of pendingReminders) {
          try {
            const jid = reminder.phone.includes("@") ? reminder.phone : `${reminder.phone}@s.whatsapp.net`;
            console.log(`[Scheduler] Sending reminder ${reminder.id} to ${jid}`);
            await whatsappManager.sendMessage(reminder.user_id, jid, `🔔 LEMBRETE: ${reminder.message}`);
            await supabaseAdmin.from("reminders").update({ sent: true }).eq("id", reminder.id);
            console.log(`[Scheduler] Reminder ${reminder.id} sent successfully.`);
          } catch (err: any) {
            console.error(`[Scheduler] Failed to send reminder ${reminder.id}:`, err.message);
          }
        }
      }

      if (!pendingMessages || pendingMessages.length === 0) {
        // Only log if we found status or reminders but no messages
        if ((pendingStatus && pendingStatus.length > 0) || (pendingReminders && pendingReminders.length > 0)) {
          // already logged above
        }
        return;
      }

      console.log(`[Scheduler] Found ${pendingMessages.length} pending messages.`);

      for (const msg of pendingMessages) {
        try {
          let jid = "";
          if (msg.target_type === 'status') {
            jid = "status@broadcast";
          } else {
            // Fetch contact phone separately
            const { data: contactData, error: contactError } = await supabaseAdmin
              .from("contacts")
              .select("phone")
              .eq("id", msg.contact_id)
              .single();

            if (contactError || !contactData?.phone) {
              throw new Error(`Contact phone not found for contact_id: ${msg.contact_id}`);
            }

            jid = `${contactData.phone}@s.whatsapp.net`;
          }

          console.log(`[Scheduler] Sending message ${msg.id} to ${jid}`);
          
          const result = await whatsappManager.sendMessage(
            msg.user_id, 
            jid, 
            msg.message,
            msg.media_url,
            msg.media_type,
            undefined,
            msg.media_mimetype,
            msg.media_filename
          );

          console.log(`[Scheduler] Message ${msg.id} sent successfully:`, result?.key?.id || "OK");

          await supabaseAdmin
            .from("scheduled_messages")
            .update({ 
              status: "sent"
            })
            .eq("id", msg.id);
          
        } catch (err: any) {
          console.error(`[Scheduler] Failed to send message ${msg.id}:`, err.message);
          await supabaseAdmin
            .from("scheduled_messages")
            .update({ 
              status: "failed",
              error: err.message || "Unknown error"
            })
            .eq("id", msg.id);
        }
      }
    } catch (err: any) {
      const text = `${err?.message || ""} ${err?.cause || ""}`;
      const transientNet =
        text.includes("fetch failed") ||
        text.includes("ENOTFOUND") ||
        text.includes("EAI_AGAIN") ||
        text.includes("getaddrinfo");
      
      // Ignore "relation does not exist" or PostgREST schema cache errors if the user hasn't created the table yet
      if (isSchemaError(err)) {
        // Silently ignore to avoid spamming the console before the user runs the SQL script
      } else if (transientNet) {
        if (!(globalThis as any).__schedulerNetWarned) {
          (globalThis as any).__schedulerNetWarned = true;
          console.warn(
            "[Scheduler] Supabase unreachable (DNS/rede). Agendamentos pausam até resolver. Em produção com rede OK isto não aparece. Local: teste `nslookup <project>.supabase.co` ou mude DNS (ex. 1.1.1.1)."
          );
        }
      } else {
        console.error("Scheduler error:", err?.message || err);
      }
    } finally {
      isRunning = false;
    }
  }, 60000); // Check every minute
}
