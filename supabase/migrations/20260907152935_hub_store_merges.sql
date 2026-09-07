-- Explicitly approved identity merges only. Ordinary clients cannot read/write
-- this integration ledger; it contains no names, addresses or financial data.
CREATE TABLE public.hub_store_merges (
  old_store_id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.client_store(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (old_store_id <> store_id)
);
ALTER TABLE public.hub_store_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_store_merges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hub_store_merges TO service_role;
COMMENT ON TABLE public.hub_store_merges IS 'Approved store identity tombstones for hub reconciliation. Never infer merges from names.';
