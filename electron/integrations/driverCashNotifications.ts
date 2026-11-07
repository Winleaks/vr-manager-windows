import { randomUUID } from 'node:crypto';
import { RealtimeClient } from '@supabase/realtime-js';
import { db, waitForDatabaseReady } from '../database/db';
import { getDeviceRole } from '../device/deviceRole';
import { createVrBakerClient } from './vrBakerIntegration';
import { createCashWakeQueue } from './cashWakeQueue';
import { attemptDriverCashSync, bindDriverCashWake, driverCashSourceId, invalidateDriverCashEnvironment, nextDriverCashRetry, setDriverCashConnectionError } from './driverCashSync';

type Lease = { protocol_version: number; topic: string; expires_at: string; renew_after_ms: number; url: string; api_key: string };
let stopCurrent: (() => void) | undefined;
export function stopDriverCashSync() {
  invalidateDriverCashEnvironment();
  bindDriverCashWake(undefined);
  stopCurrent?.();
  stopCurrent = undefined;
}
export function startDriverCashSync() {
  stopDriverCashSync();
  if (getDeviceRole() !== 'writer') return;
  let stopped = false, socket: RealtimeClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const subscriber = randomUUID();
  const queue = createCashWakeQueue({
    drain: attemptDriverCashSync,
    nextRetry: nextDriverCashRetry,
    failed: error => (error as {retryable?: boolean})?.retryable !== false,
  });
  bindDriverCashWake(queue.wake);
  stopCurrent = () => { stopped = true; if (timer) clearTimeout(timer); socket?.disconnect(); queue.stop(); };
  function later(fn: () => void, ms: number) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms); timer.unref();
  }
  async function connect() {
    try {
      await waitForDatabaseReady();
      if (stopped || getDeviceRole() !== 'writer') return;
      const connection = db, source = driverCashSourceId(), client = createVrBakerClient();
      const current = () => !stopped && db === connection && getDeviceRole() === 'writer';
      const acquire = async () => {
        const lease = await client.request<Lease>('driver.cash.subscribe', {source_id: source, subscriber_id: subscriber});
        if (lease.protocol_version !== 1 || !/^cash-writer:[a-f0-9]{64}$/.test(lease.topic) ||
            lease.url !== 'https://qcblxsbzopvsgohfghrv.supabase.co' || typeof lease.api_key !== 'string' ||
            !Number.isFinite(Date.parse(lease.expires_at)) || Date.parse(lease.expires_at) <= Date.now() ||
            lease.renew_after_ms !== 600000) throw Error('Canalul de notificări nu este valid.');
        return lease;
      };
      const lease = await acquire();
      if (!current()) return;
      socket?.disconnect();
      const active = new RealtimeClient(`${lease.url}/realtime/v1`, {
        params: {apikey: lease.api_key}, accessToken: async () => lease.api_key,
        reconnectAfterMs: tries => Math.min(300000, 1000 * 2 ** Math.min(tries, 8)),
      });
      socket = active;
      active.channel(lease.topic, {config: {private: true, broadcast: {self: false}}})
        .on('broadcast', {event: 'cash_changed'}, () => { if (current()) queue.wake(); })
        .subscribe(status => {
          if (!current() || socket !== active) return;
          if (status === 'SUBSCRIBED') { failures = 0; queue.wake(); }
          else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) reconnect();
        });
      async function renew() {
        try {
          const fresh = await acquire();
          if (!current() || socket !== active) return;
          if (fresh.topic !== lease.topic) { active.disconnect(); void connect(); return; }
          later(() => void renew(), fresh.renew_after_ms);
        } catch { if (current() && socket === active) reconnect(); }
      }
      later(() => void renew(), lease.renew_after_ms);
    } catch {
      if (!stopped) reconnect();
    }
  }
  function reconnect() {
    setDriverCashConnectionError();
    const previous = socket; socket = undefined; previous?.disconnect();
    later(() => void connect(), Math.min(300000, 5000 * 2 ** Math.min(failures++, 6)));
  }
  void connect();
}
