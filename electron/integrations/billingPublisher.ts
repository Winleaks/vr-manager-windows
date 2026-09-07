import { db, waitForDatabaseReady } from "../database/db";
import { getDeviceRole } from "../device/deviceRole";
import { createVrBakerClient } from "./vrBakerIntegration";
import {
  acknowledgeBillingDelivery,
  prepareBillingDelivery,
} from "../database/billingPublication";
let running = false;
export async function publishBilling() {
  if (running || getDeviceRole() !== "writer") return;
  running = true;
  try {
    await waitForDatabaseReady();
    if (getDeviceRole() !== "writer") return;
    const connection = db;
    const client = createVrBakerClient();
    const control = await client.request<{ sync_enabled: boolean }>(
      "billing.status",
    );
    if (!control.sync_enabled || getDeviceRole() !== "writer") return;
    const queue = db.prepare(
      "SELECT company_id FROM billing_publication_queue WHERE revision>published_revision AND retry_at<=? ORDER BY company_id",
    ).all(Date.now()) as { company_id: number }[];
    for (const { company_id } of queue) {
      try {
        if (getDeviceRole() !== "writer" || db !== connection) return;
        const data = prepareBillingDelivery(db, company_id);
        const parts = Math.max(
          1,
          Math.ceil(Math.max(data.invoices.length, data.deleted.length) / 50),
        );
        for (let part = 0; part < parts; part++) {
          if (getDeviceRole() !== "writer" || db !== connection) return;
          await client.request("billing.stage", {
            ...data,
            invoices: data.invoices.slice(part * 50, (part + 1) * 50),
            deleted: data.deleted.slice(part * 50, (part + 1) * 50),
            part,
            parts,
          }, `${data.source_id}:${company_id}:${data.revision}:part:${part}`);
        }
        if (getDeviceRole() !== "writer" || db !== connection) return;
        await client.request("billing.commit", {
          source_id: data.source_id,
          company_id: data.company_id,
          revision: data.revision,
        }, `${data.source_id}:${company_id}:${data.revision}:commit`);
        if (db !== connection) return;
        acknowledgeBillingDelivery(db, company_id, data.revision);
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
    /* Endpoint/token unavailable: retain the persistent queue for the next attempt. */
  } finally {
    running = false;
  }
}
export function startBillingPublisher() {
  void publishBilling();
  setInterval(() => void publishBilling(), 300000).unref();
}
