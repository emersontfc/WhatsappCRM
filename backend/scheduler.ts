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

      // 4. Process Automated Appointment Reminders (24h & 2h before)
      try {
        const todayStr = nowISO.split("T")[0];
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrow.toISOString().split("T")[0];

        // 4a. 24h Reminders: Appointments tomorrow that haven't received 24h reminder
        const { data: apps24h } = await supabaseAdmin
          .from("appointments")
          .select(`
            id, user_id, customer_name, customer_phone, appointment_date, start_time,
            services (name),
            professionals (name)
          `)
          .eq("appointment_date", tomorrowStr)
          .eq("reminder_24h_sent", false)
          .in("status", ["scheduled", "confirmed"])
          .limit(10);

        if (apps24h && apps24h.length > 0) {
          console.log(`[Scheduler] Processing ${apps24h.length} 24h appointment reminders.`);
          for (const app of apps24h) {
            try {
              if (app.customer_phone) {
                let clean = app.customer_phone.replace(/\D/g, "");
                if (clean.length === 9 && ["82", "83", "84", "85", "86", "87"].includes(clean.slice(0, 2))) {
                  clean = `258${clean}`;
                }
                const jid = `${clean}@s.whatsapp.net`;
                const serviceName = (app.services as any)?.name || "Consulta/Serviço";
                const profName = (app.professionals as any)?.name ? ` com ${(app.professionals as any).name}` : "";

                const reminderMsg = `🔔 *LEMBRETE DE CONSULTA AMANHÃ*\n\nOlá *${app.customer_name}*!\nLembramos do seu agendamento de *${serviceName}*${profName} amanhã às *${app.start_time}*.\n\nPor favor, responda com:\n1️⃣ para *CONFIRMAR*\n2️⃣ para *REAGENDAR*`;

                await whatsappManager.sendMessage(app.user_id, jid, reminderMsg);
                console.log(`[Scheduler] 24h appointment reminder sent to ${jid}`);
              }
              await supabaseAdmin.from("appointments").update({ reminder_24h_sent: true }).eq("id", app.id);
            } catch (err: any) {
              console.error(`[Scheduler] Failed to send 24h reminder for app ${app.id}:`, err.message);
            }
          }
        }

        // 4b. 2h Reminders: Appointments today starting within 2 hours
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentTotalMinutes = currentHours * 60 + currentMinutes;

        const { data: appsToday } = await supabaseAdmin
          .from("appointments")
          .select(`
            id, user_id, customer_name, customer_phone, appointment_date, start_time,
            services (name),
            professionals (name)
          `)
          .eq("appointment_date", todayStr)
          .eq("reminder_2h_sent", false)
          .in("status", ["scheduled", "confirmed"])
          .limit(15);

        if (appsToday && appsToday.length > 0) {
          for (const app of appsToday) {
            try {
              const [ah, am] = (app.start_time || "00:00").split(":").map(Number);
              const appTotalMinutes = ah * 60 + am;
              const diffMinutes = appTotalMinutes - currentTotalMinutes;

              // If appointment is between 30 and 150 minutes away (approx 2h before)
              if (diffMinutes >= 0 && diffMinutes <= 150) {
                if (app.customer_phone) {
                  let clean = app.customer_phone.replace(/\D/g, "");
                  if (clean.length === 9 && ["82", "83", "84", "85", "86", "87"].includes(clean.slice(0, 2))) {
                    clean = `258${clean}`;
                  }
                  const jid = `${clean}@s.whatsapp.net`;
                  const serviceName = (app.services as any)?.name || "Consulta/Serviço";
                  const profName = (app.professionals as any)?.name ? ` com ${(app.professionals as any).name}` : "";

                  const reminderMsg = `⏰ *LEMBRETE: SUA CONSULTA É HOJE!*\n\nOlá *${app.customer_name}*!\nSua consulta de *${serviceName}*${profName} está agendada para hoje às *${app.start_time}*.\n\nEstamos preparando tudo para o seu atendimento. Até breve!`;

                  await whatsappManager.sendMessage(app.user_id, jid, reminderMsg);
                  console.log(`[Scheduler] 2h appointment reminder sent to ${jid}`);
                }
                await supabaseAdmin.from("appointments").update({ reminder_2h_sent: true }).eq("id", app.id);
              }
            } catch (err: any) {
              console.error(`[Scheduler] Failed to send 2h reminder for app ${app.id}:`, err.message);
            }
          }
        }
      } catch (appReminderErr: any) {
        if (!isSchemaError(appReminderErr)) {
          console.error("[Scheduler] Error in appointment reminders:", appReminderErr.message);
        }
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
