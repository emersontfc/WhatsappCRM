import { supabaseAdmin } from './supabaseAdmin';

async function testHttpSyncWithRealToken() {
  const email = 'emersontorres42@gmail.com';
  // generate a link or session
  const { data: linkData, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
  });

  if (lErr) {
    console.error('Error generating link:', lErr);
    return;
  }

  // Use the token_hash or sign in
  const tokenHash = linkData.properties?.hashed_token;
  console.log('Got link properties:', linkData.properties);

  // Or let's test calling syncCurrentSessionContacts directly on whatsappManager via an import in server context
  // Wait, let's verify if the endpoint in backend/routes/whatsapp.ts was registered properly
}

testHttpSyncWithRealToken();
