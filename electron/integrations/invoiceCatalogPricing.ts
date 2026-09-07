export interface InvoiceCatalogProduct {
  id: number;
  name: string;
  name_ro?: string;
  variant_label?: string;
  unit?: string;
  supabase_product_id: string | null;
  display_order?: number | null;
  price_standard: number;
}

// A failed lookup is not evidence that the client has no preferential tariff.
export async function priceInvoiceCatalog(
  context: { storeExternalId: string | null; products: InvoiceCatalogProduct[] },
  fetchPrices: (storeId: string) => Promise<Map<string, number>>,
) {
  const prices = context.storeExternalId ? await fetchPrices(context.storeExternalId) : null;
  return context.products.map((product) => {
    const externalId = product.supabase_product_id?.toLowerCase();
    if (prices && externalId && !prices.has(externalId)) {
      throw new Error('Un produs lipsește din tarifele VR Baker. Sincronizează catalogul și redeschide editorul.');
    }
    const unitPrice = prices && externalId ? prices.get(externalId)! : product.price_standard;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Prețul produsului este invalid.');
    return { ...product, unitPrice, priceSource: prices && externalId ? 'vr-baker' as const : 'standard' as const };
  });
}
