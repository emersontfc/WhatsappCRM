import { whatsappManager } from './whatsappManager';

async function testSyncContactsEndpoint() {
  const userId = '9744c780-39bd-48df-9a84-acaf4dec34a9';
  const result = await whatsappManager.syncCurrentSessionContacts(userId);
  console.log('Sync result:', result);
}

testSyncContactsEndpoint();
