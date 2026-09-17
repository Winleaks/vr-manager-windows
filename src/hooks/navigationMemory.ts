import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export function createMemory() {
  return { values: new Map<string, unknown>(), positions: new Map<string, number>(), listeners: new Set<() => void>() };
}
type Memory = ReturnType<typeof createMemory>;
export const MemoryContext = createContext<Memory | null>(null);
export const ScopeContext = createContext('');

function useMemory() {
  const shared = useContext(MemoryContext);
  const [fallback] = useState(createMemory);
  return shared ?? fallback;
}

export function useNavigationState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const memory = useMemory();
  const scope = useContext(ScopeContext);
  const key = `${scope}/${name}`;
  if (!memory.values.has(key)) memory.values.set(key, typeof initial === 'function' ? (initial as () => T)() : initial);
  const subscribe = useCallback((listener: () => void) => {
    memory.listeners.add(listener);
    return () => { memory.listeners.delete(listener); };
  }, [memory]);
  const snapshot = useCallback(() => memory.values.get(key) as T, [memory, key]);
  const value = useSyncExternalStore(subscribe, snapshot);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const previous = memory.values.get(key) as T;
    const value = typeof next === 'function' ? (next as (old: T) => T)(previous) : next;
    if (Object.is(previous, value)) return;
    memory.values.set(key, value);
    memory.listeners.forEach(listener => listener());
  }, [memory, key]);
  return [value, setValue];
}

export function useRememberedScroll(name: string, ready?: boolean, enabled = true) {
  const memory = useMemory();
  const scope = useContext(ScopeContext);
  const key = `${scope}/${name}`;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = ref.current;
    const scroller = content?.closest<HTMLElement>('[data-navigation-scroll]');
    if (!content || !scroller || !enabled) return;
    const target = memory.positions.get(key) ?? 0;
    let restoring = true;
    const restore = () => {
      if (!restoring || ready === false) return;
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.min(target, maximum);
      // Async lists may not have arrived yet. Observe their size until the
      // saved position exists, or the page explicitly reports it is ready.
      if (maximum >= target || ready === true) restoring = false;
    };
    const save = () => { if (!restoring) memory.positions.set(key, scroller.scrollTop); };
    const takeControl = () => { restoring = false; save(); };
    const observer = new ResizeObserver(restore);
    observer.observe(content);
    scroller.addEventListener('scroll', save, { passive: true });
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroller.addEventListener(event, takeControl, { passive: true });
    restore();
    return () => {
      // Do not read scrollTop here: React may already have removed the long
      // list, clamping it to zero. The last scroll event is authoritative.
      observer.disconnect();
      scroller.removeEventListener('scroll', save);
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroller.removeEventListener(event, takeControl);
    };
  }, [memory, key, ready, enabled]);
  return ref;
}
