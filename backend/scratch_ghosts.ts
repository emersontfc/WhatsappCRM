import { supabaseAdmin } from './supabaseAdmin';

async function checkGhostContacts() {
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

  let manual = 0;
  let hasLead = 0;
  let hasMessages = 0;
  let ghostOld = 0;
  let todayCount = 0;

  for (const c of contacts || []) {
    const cleanP = (c.phone || '').replace(/\D/g, '');
    const isManual = Array.isArray(c.tags) && (c.tags.includes('Manual') || c.tags.includes('Importado'));
    const isLead = leadContactIds.has(c.id) || leadPhones.has(cleanP);
    const hasMsg = messageContactIds.has(c.id) || Boolean(c.last_message_at);
    const isToday = c.created_at && c.created_at.startsWith('2026-09-04');

    if (isManual) manual++;
    else if (isLead) hasLead++;
    else if (hasMsg) hasMessages++;
    else if (isToday) todayCount++;
    else ghostOld++;
  }

  console.log({
    totalContacts: contacts?.length,
    manual,
    hasLead,
    hasMessages,
    todayCreated: todayCount,
    ghostFromPreviousConnections: ghostOld
  });
}

checkGhostContacts();
