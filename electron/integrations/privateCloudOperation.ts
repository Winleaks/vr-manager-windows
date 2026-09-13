import { AsyncLocalStorage } from 'node:async_hooks';

// Only folder IDs, only for the duration of one awaited operation. Never file
// contents, persistent caches, or queued writes. Each new operation resolves anew.
const operations = new AsyncLocalStorage<Map<string, Promise<string | null>>>();

export async function withPrivateCloudOperation<T>(operation: () => Promise<T>): Promise<T> {
  const entries = new Map<string, Promise<string | null>>();
  try { return await operations.run(entries, operation); }
  finally { entries.clear(); }
}

export async function resolvePrivateFolderInOperation(key: string, resolve: () => Promise<string | null>) {
  const entries = operations.getStore();
  if (!entries) return resolve();
  const existing = entries.get(key);
  if (existing) return existing;
  const pending = resolve();
  entries.set(key, pending);
  try {
    const result = await pending;
    // A missing folder may subsequently be created within the same operation.
    if (!result) entries.delete(key);
    return result;
  } catch (error) { entries.delete(key); throw error; }
}
