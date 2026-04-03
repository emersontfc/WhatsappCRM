import { supabaseAdmin } from "./supabaseAdmin.ts";
import { whatsappManager } from "./whatsappManager.ts";

export function startScheduler() {
  console.log("Message scheduler started.");
  
  let isRunning = false;

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

      const now = new Date().toISOString();
      
      const { data: pendingMessages, error } = await supabaseAdmin
        .from("scheduled_messages")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_at", now)
        .limit(10);
      
      if (error) throw error;
      if (!pendingMessages || pendingMessages.length === 0) return;

      console.log(`Scheduler found ${pendingMessages.length} pending messages.`);

      for (const msg of pendingMessages) {
        try {
          // Fetch contact phone separately to avoid PostgREST schema cache issues with joins
          const { data: contactData, error: contactError } = await supabaseAdmin
            .from("contacts")
            .select("phone")
            .eq("id", msg.contact_id)
            .single();

          if (contactError || !contactData?.phone) {
            throw new Error(`Contact phone not found for contact_id: ${msg.contact_id}`);
          }

          const phone = contactData.phone;
          console.log(`Sending scheduled message ${msg.id} to ${phone}`);
          
          await whatsappManager.sendMessage(
            msg.user_id, 
            `${phone}@s.whatsapp.net`, 
            msg.message,
            msg.media_url,
            msg.media_type
          );

          const { error: updateError } = await supabaseAdmin
            .from("scheduled_messages")
            .update({ 
              status: "sent"
            })
            .eq("id", msg.id);
            
          if (updateError) throw updateError;
          
          // Also save to message history
          await supabaseAdmin.from("messages").insert({
            user_id: msg.user_id,
            contact_id: msg.contact_id,
            text: msg.message,
            type: "outbound",
            timestamp: new Date().toISOString(),
          });

        } catch (err: any) {
          console.error(`Failed to send scheduled message ${msg.id}:`, err);
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
      // Ignore "relation does not exist" error if the user hasn't created the table yet
      if (err?.code === '42P01' || err?.message?.includes('does not exist')) {
        // Silently ignore to avoid spamming the console before the user runs the SQL script
      } else {
        console.error("Scheduler error:", err?.message || err);
      }
    } finally {
      isRunning = false;
    }
  }, 60000); // Check every minute
}
