import jwt from 'jsonwebtoken';

async function testHttpSync() {
  const userId = '9744c780-39bd-48df-9a84-acaf4dec34a9';
  const jwtSecret = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
  const token = jwt.sign(
    { sub: userId, id: userId, email: 'emersontorres42@gmail.com', role: 'authenticated', aud: 'authenticated' },
    jwtSecret,
    { expiresIn: '1h' }
  );

  const res = await fetch('http://localhost:3000/api/whatsapp/sync-contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  const json = await res.json();
  console.log('HTTP Status:', res.status, 'Response:', json);
}

testHttpSync();
