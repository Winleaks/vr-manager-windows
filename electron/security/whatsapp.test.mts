import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWhatsAppLaunchTargets } from './whatsapp.ts';

test('WhatsApp launch is constrained to the official app and web targets', () => {
  assert.deepEqual(buildWhatsAppLaunchTargets(), {
    appUrl: 'whatsapp://',
    webUrl: 'https://web.whatsapp.com/',
  });
});
