import { supabaseAdmin } from './supabaseAdmin';

async function analyzeContacts() {
  const { data: contacts, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id, name, phone, tags, last_message_at, created_at');

  if (cErr) {
    console.error('Error:', cErr);
    return;
  }

  const { data: messages, error: mErr } = await supabaseAdmin
    .from('messages')
    .select('id, contact_id, text, timestamp')
    .order('timestamp', { ascending: false });

  if (mErr) {
    console.error('Error msg:', mErr);
    return;
  }

  console.log(`Total contacts: ${contacts.length}`);
  console.log(`Total messages in DB: ${messages.length}`);

  const contactsWithLastMsg = contacts.filter(c => c.last_message_at != null);
  console.log(`Contacts with last_message_at: ${contactsWithLastMsg.length}`);

  const contactIdsInMessages = new Set(messages.map(m => m.contact_id).filter(Boolean));
  console.log(`Distinct contact_ids with messages: ${contactIdsInMessages.size}`);

  const contactsWithRealName = contacts.filter(c => {
    const raw = (c.name || '').trim();
    const phone = (c.phone || '').replace(/\D/g, '');
    const isNum = !raw || /^[\d\s+()\-#]+$/.test(raw) || raw.replace(/\D/g, '') === phone;
    return !isNum && raw !== '</>' && raw !== 'Sem Nome';
  });
  console.log(`Contacts with a distinct name: ${contactsWithRealName.length}`);
  console.log(`Contacts without distinct name (only phone): ${contacts.length - contactsWithRealName.length}`);

  // Check tags
  const manualCount = contacts.filter(c => Array.isArray(c.tags) && (c.tags.includes('Manual') || c.tags.includes('Importado'))).length;
  const whatsappOnly = contacts.filter(c => !Array.isArray(c.tags) || (!c.tags.includes('Manual') && !c.tags.includes('Importado'))).length;
  console.log(`Manual/Imported contacts: ${manualCount}`);
  console.log(`WhatsApp only contacts: ${whatsappOnly}`);
}

analyzeContacts();
