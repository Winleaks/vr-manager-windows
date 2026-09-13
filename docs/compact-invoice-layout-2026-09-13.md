# Compact invoice layout (unpublished)

Approved scope: fit more products per page without reducing font size, changing financial data, or publishing automatically.

- Common normal/protected renderer keeps Arial 7.5pt and bilingual descriptions. Vertical body padding drops from 1.5mm to 0.7mm, horizontal padding stays 1.5mm. Table header vertical padding drops from 2mm to 1.5mm.
- Account-balance header is 5mm shorter overall; same text and amount remain visible at the top right.
- Product pages reserve only the existing footer plus 2mm clearance. The 18mm total card plus gap is no longer reserved on every page. Existing final-summary fit check places it after the final row or on the next page when needed. Rows remain unsplit and continuation pages repeat headers.
- Approved sample: all 22 product rows and invoice total now fit on page 1 (previously 17 products). Outstanding invoices remain on page 2 because page 1 is full. Exact capacity varies with address and product-description length.
- PDF text extraction confirms every original quantity/unit price/line total unchanged and body font still 7.5pt. Both pages visually inspected. A 55-product long bilingual description fixture spans four pages, with all row identifiers exactly once, intact footers and no text outside page bounds; first/last page visually checked.
- 325 tests pass; TypeScript, scoped lint, renderer/main/preload build and diff checks pass. The prior two-page product fixture now correctly expects one page; added long-description pagination coverage for VAT/non-VAT.
- No schema/storage/financial changes, no live PDFs modified. Installed-Windows print check remains unperformed. Do not push the existing release branch to publish these changes: prepare a new version after a fresh release check.
