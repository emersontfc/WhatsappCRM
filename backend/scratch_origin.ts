import { supabaseAdmin } from './supabaseAdmin';

async function checkContactsOrigin() {
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, name, phone, tags, last_message_at, created_at')
    .order('created_at', { ascending: false });

  if (!contacts) return;

  // Group by created_at date/hour
  const byDate: Record<string, number> = {};
  for (const c of contacts) {
    const d = c.created_at ? c.created_at.slice(0, 13) : 'unknown';
    byDate[d] = (byDate[d] || 0) + 1;
  }
  console.log('Contacts created by date/hour:', byDate);

  // Check how many have messages in messages table
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('contact_id');
  
  const idsWithMsg = new Set(messages?.map(m => m.contact_id));
  console.log('Contacts with messages in DB:', idsWithMsg.size);

  // How many have last_message_at != null
  const withLastMsg = contacts.filter(c => c.last_message_at != null);
  console.log('Contacts with last_message_at != null:', withLastMsg.length);

  // Show some examples of contacts with messages vs without messages
  const sampleWithMsg = contacts.filter(c => idsWithMsg.has(c.id));
  console.log('Sample with messages:', sampleWithMsg.map(c => ({ name: c.name, phone: c.phone, last_msg: c.last_message_at })));
}

checkContactsOrigin();
