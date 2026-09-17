import { useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { createMemory, MemoryContext, ScopeContext, useRememberedScroll } from '../hooks/navigationMemory';

/** Session-only UI preferences. Unmounting (including a protected-register lock)
 * discards them; no business data or browser/disk storage is involved. */
export function NavigationMemory({ children }: { children: ReactNode }) {
  const [memory] = useState(createMemory);
  return <MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider>;
}

export function NavigationView({ name, children, restore = true, className }: { name: string; children: ReactNode; restore?: boolean; className?: string }) {
  const scope = useContext(ScopeContext);
  const ref = useRememberedScroll(name, undefined, restore);
  return <ScopeContext.Provider value={`${scope}/${name}`}><div data-navigation-view ref={ref} className={className}>{children}</div></ScopeContext.Provider>;
}
