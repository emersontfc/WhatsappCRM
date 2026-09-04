import { supabaseAdmin } from './supabaseAdmin';

async function checkUsersInContacts() {
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('user_id');

  const userCounts: Record<string, number> = {};
  for (const c of contacts || []) {
    userCounts[c.user_id] = (userCounts[c.user_id] || 0) + 1;
  }
  console.log('Contacts per user_id:', userCounts);
}

checkUsersInContacts();
