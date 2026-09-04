import { supabaseAdmin } from './supabaseAdmin';

async function dryRunCleanup() {
  const userId = '9744c780-39bd-48df-9a84-acaf4dec34a9';

  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, name, phone, tags, last_message_at, created_at')
    .eq('user_id', userId);

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('contact_id, phone')
    .eq('user_id', userId);

  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('contact_id')
    .eq('user_id', userId);

  const leadContactIds = new Set(leads?.map(l => l.contact_id).filter(Boolean));
  const leadPhones = new Set(leads?.map(l => (l.phone || '').replace(/\D/g, '')).filter(Boolean));
  const messageContactIds = new Set(messages?.map(m => m.contact_id).filter(Boolean));

  const toKeep: any[] = [];
  const toDelete: any[] = [];

  for (const c of contacts || []) {
    const cleanP = (c.phone || '').replace(/\D/g, '');
    const tags = Array.isArray(c.tags) ? c.tags : [];
    const isManual = tags.includes('Manual') || tags.includes('Importado');
    const hasLead = leadContactIds.has(c.id) || leadPhones.has(cleanP);
    const hasMessages = messageContactIds.has(c.id) || Boolean(c.last_message_at);
    // Contacts created today (current active connection)
    const isToday = c.created_at && c.created_at.startsWith('2026-09-04');

    if (isManual || hasLead || hasMessages || isToday) {
      toKeep.push(c);
    } else {
      toDelete.push(c);
    }
  }

  console.log(`Total: ${contacts?.length}`);
  console.log(`To KEEP: ${toKeep.length}`);
  console.log(`To DELETE (orphans from previous connections): ${toDelete.length}`);

  // Sample to keep
  console.log('Sample TO KEEP (first 5):', toKeep.slice(0, 5).map(c => ({ name: c.name, phone: c.phone, tags: c.tags, created_at: c.created_at })));
  // Sample to delete
  console.log('Sample TO DELETE (first 5):', toDelete.slice(0, 5).map(c => ({ name: c.name, phone: c.phone, created_at: c.created_at })));
}

dryRunCleanup();
