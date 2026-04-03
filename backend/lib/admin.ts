import { supabaseAdmin } from "../supabaseAdmin.ts";

export const getAdminEmails = (): string[] => {
  const envAdminEmails = process.env.ADMIN_EMAIL || "alcindacharles@gmail.com,emersontorres42@gmail.com";
  return envAdminEmails.split(",").map(e => e.trim().toLowerCase());
};

export const isAdminEmail = (email: string): boolean => {
  if (!email) return false;
  const adminEmails = getAdminEmails();
  return adminEmails.includes(email.toLowerCase());
};

export const ensureAdminRole = async (userId: string, email: string) => {
  if (isAdminEmail(email)) {
    console.log(`[Admin Lib] Ensuring admin role for user ${userId} (${email})`);
    const { error } = await supabaseAdmin
      .from("users")
      .update({ role: "admin", plan: "Admin" })
      .eq("id", userId);
    
    if (error) {
      console.error(`[Admin Lib] Error updating admin role for ${userId}:`, error);
    } else {
      console.log(`[Admin Lib] Successfully ensured admin role for ${userId}`);
    }
  }
};
