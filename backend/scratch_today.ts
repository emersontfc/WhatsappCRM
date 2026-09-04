import { supabaseAdmin } from './supabaseAdmin';

async function checkTodayContacts() {
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, name, phone, tags, last_message_at, created_at')
    .gte('created_at', '2026-09-04T00:00:00Z')
    .order('created_at', { ascending: false });

  console.log(`Contacts created today: ${contacts?.length}`);
  const sample = contacts?.slice(0, 15);
  console.log('Sample created today:', sample);

  // Check how many have distinct names
  const withNames = contacts?.filter(c => {
    const raw = (c.name || '').trim();
    const phone = (c.phone || '').replace(/\D/g, '');
    return raw && raw !== phone && !/^[\d\s+()\-#]+$/.test(raw) && raw !== '</>' && raw !== 'Sem Nome';
  });
  console.log(`Today contacts with real names (gravados): ${withNames?.length}`);
  console.log(`Today contacts without real names: ${(contacts?.length || 0) - (withNames?.length || 0)}`);
}

checkTodayContacts();
