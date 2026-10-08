import { db, waitForDatabaseReady } from "../database/db";
import { getDeviceRole } from "../device/deviceRole";
import { createVrBakerClient } from "./vrBakerIntegration";
import { retiredLegacyCompanyIds } from '../database/legacyEntityRepair';
import { normalBillingReadDatabase } from '../database/normalBillingVisibility';
import {
  acknowledgeBillingDelivery,
  prepareBillingDelivery,
} from "../database/billingPublication";
let running = false;
let scheduled: ReturnType<typeof setTimeout> | null = null;
let requested = false;
const immediateCompanies = new Set<number>();
let immediateDatabase = db;

/** Called only after a payment was committed locally. One explicit wake-up can
 * bypass this company's backoff; failures retain the usual durable retry. */
export function publishCompanyPaymentNow(companyId: number) {
  if (getDeviceRole() !== 'writer') return;
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error('Compania încasării este invalidă.');
  if (immediateDatabase !== db) { immediateCompanies.clear(); immediateDatabase = db; }
  immediateCompanies.add(companyId);
  if (scheduled) { clearTimeout(scheduled); scheduled = null; }
  if (running) return;
  requested = false;
  void publishBilling();
}
/** Event-driven wake-up; durable SQLite revisions remain the source of pending work. */
export function scheduleBillingPublication() {
  if (getDeviceRole() !== 'writer') return;
  requested = true;
  if (running || scheduled) return;
  scheduled = setTimeout(() => { scheduled = null; requested = false; void publishBilling(); }, 250);
  scheduled.unref();
}
export function isBillingPublishing() { return running; }
export async function publishBilling() {
  if (running || getDeviceRole() !== "writer") return;
  if (immediateDatabase !== db) { immediateCompanies.clear(); immediateDatabase = db; }
  running = true;
  try {
    await waitForDatabaseReady();
    if (getDeviceRole() !== "writer") return;
    const { ensureNormalBillingVisibility } = await import('../protectedRegistry/service');
    await ensureNormalBillingVisibility();
    const connection = db;
    const client = createVrBakerClient();
    const control = await client.request<{ sync_enabled: boolean; protocol_version?: number; drive_folder_id?: string }>(
      "billing.status",
    );
    if (db !== connection || getDeviceRole() !== 'writer') return;
    if(control.drive_folder_id && /^[A-Za-z0-9_-]{10,200}$/.test(control.drive_folder_id)) {
      const setting=db.prepare("SELECT value FROM app_settings WHERE key='invoice_drive_folder_id'").get() as {value:string}|undefined;
      if(setting?.value && setting.value!==control.drive_folder_id) throw new Error('Folderul facturilor diferă de platformă.');
      db.prepare("INSERT INTO app_settings(key,value) VALUES('invoice_drive_folder_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(control.drive_folder_id);
    }
    if(control.sync_enabled && control.protocol_version !== 2) throw new Error('Platforma necesită actualizarea protocolului financiar.');
    if (!control.sync_enabled) { immediateCompanies.clear(); return; }
    if (getDeviceRole() !== "writer") return;
    const priority = new Set(immediateCompanies);
    immediateCompanies.clear();
    const ids = [...priority];
    const prioritySql = ids.length ? ` OR q.company_id IN (${ids.map(() => '?').join(',')})` : '';
    const queue = normalBillingReadDatabase(db).prepare(
      `SELECT q.company_id FROM billing_publication_queue q JOIN companies c ON c.id=q.company_id WHERE q.revision>q.published_revision AND (q.retry_at<=?${prioritySql}) AND c.vrbaker_missing=0 ORDER BY q.company_id`,
    ).all(Date.now(), ...ids) as { company_id: number }[];
    queue.sort((a,b) => Number(priority.has(b.company_id)) - Number(priority.has(a.company_id)));
    const retired = retiredLegacyCompanyIds(db);
    for (const { company_id } of queue.filter(row=>!retired.has(row.company_id))) {
      try {
        // A new operator receipt takes the next turn after the current
        // company's atomic commit, ahead of the remaining background backlog.
        if (immediateCompanies.size) {
          // Preserve explicit requests not yet attempted when a newer receipt
          // interrupts this snapshot, including companies still in backoff.
          for (const row of queue) if (priority.has(row.company_id) && !retired.has(row.company_id)) immediateCompanies.add(row.company_id);
          break;
        }
        priority.delete(company_id);
        if (getDeviceRole() !== "writer" || db !== connection) return;
        const visible = () => normalBillingReadDatabase(db).prepare('SELECT 1 FROM companies WHERE id=? AND vrbaker_missing=0').get(company_id);
        if (!visible()) continue;
        const data = prepareBillingDelivery(db, company_id);
        const parts = Math.max(
          1,
          Math.ceil(Math.max(data.invoices.length, data.deleted.length) / 50),
        );
        for (let part = 0; part < parts; part++) {
          if (getDeviceRole() !== "writer" || db !== connection) return;
          if (!visible()) throw new Error('Compania nu mai este disponibilă în facturarea normală.');
          await client.request("billing.stage", {
            ...data,
            invoices: data.invoices.slice(part * 50, (part + 1) * 50),
            deleted: data.deleted.slice(part * 50, (part + 1) * 50),
            part,
            parts,
          }, `${data.source_id}:${company_id}:${data.revision}:part:${part}`);
        }
        if (getDeviceRole() !== "writer" || db !== connection) return;
        if (!visible()) continue;
        await client.request("billing.commit", {
          source_id: data.source_id,
          company_id: data.company_id,
          revision: data.revision,
        }, `${data.source_id}:${company_id}:${data.revision}:commit`);
        if (db !== connection) return;
        acknowledgeBillingDelivery(db, company_id, data.revision);
        // Finish an older immutable delivery first, then send the newest
        // receipt immediately instead of waiting for another scheduled batch.
        if (db.prepare('SELECT 1 FROM billing_publication_queue WHERE company_id=? AND revision>published_revision').get(company_id)) immediateCompanies.add(company_id);
      } catch (error) {
        if (db !== connection) return;
        const localMessage = error instanceof Error &&
            /asociere|duplicată|sumă|Suma|Factura/.test(error.message)
          ? error.message
          : "Publicarea a eșuat. Verifică asocierea companiei/magazinelor, permisiunea billing:write și configurația platformei.";
        db.prepare(
          `UPDATE billing_publication_queue SET last_error=?, attempts=attempts+1, retry_at=? WHERE company_id=?`,
        ).run(localMessage, Date.now() + 300000, company_id);
      }
    }
  } catch {
    // Failed connection/visibility verification must not cause a tight loop.
    // Durable financial revisions remain pending for the periodic retry.
    immediateCompanies.clear();
    if(getDeviceRole()==='writer') db.prepare("UPDATE billing_publication_queue SET last_error=?,retry_at=? WHERE revision>published_revision").run('Publicarea este indisponibilă. Verifică protocolul platformei și permisiunea billing:write.',Date.now()+300000);
  } finally {
    running = false;
    if (getDeviceRole() !== 'writer' || immediateDatabase !== db) immediateCompanies.clear();
    if (immediateCompanies.size) {
      requested = false;
      if (scheduled) { clearTimeout(scheduled); scheduled = null; }
      void publishBilling();
    } else if (requested) scheduleBillingPublication();
  }
}
export function startBillingPublisher() {
  void publishBilling();
  setInterval(() => void publishBilling(), 300000).unref();
}
