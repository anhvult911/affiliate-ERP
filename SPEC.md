# SPEC P6-6b — Lazada link support, v1 (no schema change) — revised after review #47

Repo: `affiliate-ERP` · Branch: `task/P6-6-lazada` (already exists) · Owner: OpenCode · Reviewer: Hermes

## Read first
`src/lib/products/parse-links.ts` was just hardened in #47. Do not undo any of it:
- Shopee item id is the **last** group (`...-i.<shopId>.<itemId>`, `/product/<shopId>/<itemId>`).
- `ALLOWED_AFFILIATE_HOSTS` already lists `lazada.vn` and `s.lazada.vn`; `isAllowedAffiliateHost()` accepts `www.`/subdomains.
- Malformed percent-escapes must stay a per-line issue, never a thrown `URIError`.
- `parseProductLinks` must keep reporting problems per line with line numbers.

## Goal
A Lazada affiliate link behaves like a first-class product: paste → product row → caption that
says Lazada → the affiliate link is never mangled by the Shopee shortener.

## Hard constraints
1. **No database migration, no new dependencies.**
2. Do not touch `supabase/**`, `workers/**`, `src/app/api/**`, `.github/**`.
3. Keep the suite green: `node --import tsx --test "tests/*.test.ts"` and `./node_modules/.bin/tsc --noEmit`.
4. Never weaken or delete an existing test; the item-id agreement test must keep passing.

## Files you own
- `src/lib/products/platform.ts` — **new**: `platformOf(link): "shopee" | "lazada" | "other"`
- `src/lib/products/parse-links.ts` — Lazada slug parsing (`-i<itemId>-s<skuId>.html`), keep Shopee behaviour byte-identical
- `src/lib/products/parse-csv.ts` — accept Lazada links in the link column (id extraction for `-i<id>-s<sku>`)
- `src/lib/deals/copy.ts`, `src/lib/deals/generate.ts` — platform-aware label/hashtag
- `src/lib/shopee/short-link.ts` — return non-Shopee links untouched, never call the Shopee API for them
- `src/components/products/product-form.tsx` — show the detected platform (read-only is fine)
- `tests/parse-links.test.ts`, `tests/deal-copy.test.ts`, `tests/platform.test.ts` (**new**)

## Acceptance criteria (each proven by a test)
1. `platformOf()`: `shopee.vn`/`s.shopee.vn`/`shp.ee` → `shopee`; `lazada.vn`/`s.lazada.vn` → `lazada`;
   anything else → `other`; case-insensitive; `www.` and subdomains tolerated.
2. `parseProductLinks("https://www.lazada.vn/products/noi-chien-khong-dau-philips-hd9200-i1234567890-s9876543210.html")`
   → name `noi chien khong dau philips hd9200`, `shopeeItemId = "1234567890"`, platform `lazada`.
3. `parseProductLinks("https://s.lazada.vn/s.abc123")` without a name → per-line issue; with
   `| Tên sản phẩm` → product created with `shopeeItemId = null`.
4. Shopee slugs and `/product/<shopId>/<itemId>` still yield the **same** item ids as before #47
   (the existing agreement test must pass unchanged).
5. Deal copy for a Lazada product names Lazada and does not claim Shopee; Shopee copy keeps its
   exact current strings (assert against the existing expected values).
6. `short-link.ts`: a Lazada product returns its own `affiliate_short_link` unchanged and makes
   **no** Shopee API call (stub `fetch` and assert it was not called).
7. A CSV row with a Lazada link imports with the same item id the paste parser derives.

## Deliverable
- One commit on `task/P6-6-lazada`: `feat(products): support Lazada affiliate links (v1, no schema change)`
- Final message: changed files, commands run with pass/fail counts, anything not satisfied and why.
- Do **not** push, do **not** open a PR, do **not** merge.

## Out of scope
Open API integration, migrations, worker/browser code, UI redesign, price syncing, anything in #47's
deferred list.
