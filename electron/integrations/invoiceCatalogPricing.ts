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

export type PricedInvoiceCatalogProduct = InvoiceCatalogProduct & {
  unitPrice: number | null;
  priceSource: 'vr-baker' | 'standard' | 'unverified';
  priceIssue?: 'unavailable' | 'missing' | 'invalid';
};

type CatalogContext = { storeExternalId: string | null; products: InvoiceCatalogProduct[] };

export function localInvoiceCatalog(context: CatalogContext): PricedInvoiceCatalogProduct[] {
  return context.products.map((product) => {
    const standardValid = Number.isFinite(product.price_standard) && product.price_standard >= 0;
    const needsVerification = Boolean(context.storeExternalId && product.supabase_product_id);
    return { ...product, unitPrice: !needsVerification && standardValid ? product.price_standard : null,
      priceSource: !needsVerification && standardValid ? 'standard' : 'unverified',
      ...(!needsVerification && !standardValid ? { priceIssue: 'invalid' as const } : {}),
    };
  });
}

// A failed lookup is not evidence that the client has no preferential tariff.
export async function priceInvoiceCatalog(
  context: CatalogContext,
  fetchPrices: (storeId: string) => Promise<Map<string, number>>,
): Promise<PricedInvoiceCatalogProduct[]> {
  const catalog = localInvoiceCatalog(context);
  if (!catalog.some((product) => product.priceSource === 'unverified' && product.supabase_product_id) || !context.storeExternalId) return catalog;
  let prices: Map<string, number>;
  try { prices = await fetchPrices(context.storeExternalId); }
  catch {
    // Do not send raw provider errors/credentials to the renderer, and never
    // interpret a failed request as confirmation of a standard client tariff.
    return catalog.map((product) => product.priceSource === 'unverified' ? { ...product, priceIssue: 'unavailable' } : product);
  }
  return catalog.map((product) => {
    const externalId = product.supabase_product_id?.toLowerCase();
    if (!externalId) return product;
    if (!prices.has(externalId)) return { ...product, unitPrice: null, priceSource: 'unverified', priceIssue: 'missing' };
    const unitPrice = prices.get(externalId)!;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { ...product, unitPrice: null, priceSource: 'unverified', priceIssue: 'invalid' };
    return { ...product, unitPrice, priceSource: 'vr-baker' };
  });
}
