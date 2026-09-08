const pending = new Map<string,Promise<unknown>>();

export function withDriveFolderLock<T>(parent: string, name: string, action: () => Promise<T>): Promise<T> {
  const key=JSON.stringify([parent,name]);
  const next=(pending.get(key) || Promise.resolve()).catch(()=>{}).then(action);
  pending.set(key,next);
  void next.finally(()=>{if(pending.get(key)===next)pending.delete(key)}).catch(()=>{});
  return next;
}
