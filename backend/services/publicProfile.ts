import { supabaseAdmin } from "../supabaseAdmin.ts";

export async function createStandardProfile(userId: string, email: string, name?: string) {
  const { data, error } = await supabaseAdmin.from("users").insert({
    id: userId,
    email,
    name: name || email.split("@")[0] || "Utilizador",
    role: "user",
    plan: "Free"
  }).select("*").single();
  if (!error && data?.id === userId) return data;

  // A concurrent read or an existing database trigger may have provisioned this identity.
  if (error?.code === "23505") {
    const existing = await supabaseAdmin.from("users").select("*").eq("id", userId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.id === userId) return existing.data;
  }

  throw error ?? new Error("Profile write not confirmed");
}
