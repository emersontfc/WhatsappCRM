import { whatsappManager } from './whatsappManager';

async function checkCurrentSession() {
  const userId = '9744c780-39bd-48df-9a84-acaf4dec34a9';
  const session = whatsappManager.getSession(userId);
  console.log('Session status:', session?.status);
  const me = whatsappManager.getMe(userId);
  console.log('Me info:', me);
}

checkCurrentSession();
