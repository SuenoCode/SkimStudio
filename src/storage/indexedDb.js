async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SkimStudio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function storeProject(value) { return transact('readwrite', store => store.put(value, 'autosave')); }
export async function loadProject() { return transact('readonly', store => store.get('autosave')); }
async function transact(mode, operation) {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', mode); const request = operation(transaction.objectStore('projects'));
    transaction.oncomplete = () => resolve(request.result); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('Storage transaction aborted.'));
  }); } finally { db.close(); }
}
