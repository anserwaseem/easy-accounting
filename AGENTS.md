# Agent memory

## Learned User Preferences

- Prefer small, domain-focused hooks over one large hook so no single hook becomes a behemoth.
- Stabilize callbacks passed to hooks (e.g. useCallback) when they appear in effect dependency arrays to avoid infinite re-render loops.
- Add comments to zod schema refinements and to each useEffect for clarity and future maintenance.
- Add comments to non-obvious derived state (e.g. createPolicyHint-style useMemos) explaining each branch.
- When refactoring large components: extract subcomponents and/or domain hooks first; optionally group related files in a folder with a barrel export.
- Prefer a skeptical, high-standards approach: double check assumptions and call out issues rather than agreeing by default.

## Learned Workspace Facts

- New Invoice screen uses domain-split hooks (inventory, next number, parties, form core, sections, resolution, discounts) rather than one useNewInvoiceForm.
- Project is configured to run locally on port 3001 (npm start).
- Journal `billNumber` is set from `invoiceNumber`; journal `discountPercentage` is derived from the account’s discount profile per item type only when a single policy discount applies (otherwise left unset; missing `itemTypeId` is treated as 0%).
- Some customers have multiple accounts suffixed by item-type/discount tiers (e.g. `-T`, `-TT`); a single invoice can split ledger/journals per suffixed account while still being “one invoice per customer”.
- Customer item-type tier for sale invoices uses **account code** only (`getHeaderTypedSuffixFromCode`): split-by-type row resolution and split-off mismatch warnings; display names are not authoritative.
