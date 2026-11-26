import { supabaseAdmin } from "../supabaseAdmin.ts";

export async function readSellerAvailableStock(userId: string) {
  const { data, error } = await supabaseAdmin.rpc("agentx_seller_catalog_availability", { p_user: userId })
    .abortSignal(AbortSignal.timeout(6_000));
  if (error) throw error;
  const rows = (data ?? []) as { product_id: string; available_stock: number }[];
  return new Map(rows.map((row) => [row.product_id, row.available_stock]));
}
