import { supabaseAdmin } from "./backend/supabaseAdmin";

async function checkData() {
  const { data, error } = await supabaseAdmin
    .from("quick_reply")
    .select("*")
    .limit(5);
  
  if (error) console.error("Error fetching data:", error);
  else console.log("Quick replies data:", data);
}

checkData();
