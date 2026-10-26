# Shopee Affiliate Open API — Spec tích hợp cho affiliate-ERP

> Mục tiêu (đóng README gap #15 "Direct API discovery remains open"): thay quy trình
> **nhập CSV tay** và **đối soát tay** bằng direct API cho Shopee, dùng đúng schema
> `products` / `comment_tasks` / `affiliate_conversions` hiện có.
>
> **Quy tắc đọc tài liệu này:** mọi claim kỹ thuật đánh dấu mức độ tin cậy —
> `[Xác minh]` = có nguồn URL hoặc đã probe trực tiếp ngày 2026-10-26;
> `[Chưa xác minh]` = suy đoán từ nguồn thứ cấp hoặc chưa kiểm chứng bằng tài khoản
> affiliate thật, **phải verify trước khi code depend vào đó**.
> Không endpoint nào trong file này được bịa: mỗi endpoint đều trích từ nguồn liệt kê ở mục 8.

---

## 1. Tổng quan & mục tiêu tích hợp

Shopee Affiliate Program cung cấp **Open API (GraphQL)** cho publisher (người làm
affiliate), tách biệt với Shopee Open Platform (open.shopee.com — API phía **seller**,
dùng HMAC-SHA256 + access_token; **không** phải thứ chúng ta cần).

Ba nhóm khả năng của Affiliate Open API
`[Xác minh — help.shopee.sg/10/article/191702-API-Access, official, region SG]`:

1. **Get Shopee / Brand / Product Offer Lists** — tìm sản phẩm có offer + commission rate.
2. **Get Short Link** — đổi link sản phẩm Shopee thành link affiliate ngắn (`shope.ee/...`) gắn sub id.
3. **Get Conversion & Validated Reports** — pull đơn hàng + hoa hồng (ước tính và đã validated).

Vị trí trong pipeline hiện tại của repo:

| Mảng việc | Hiện tại (CSV/tay) | Sau tích hợp |
|---|---|---|
| Nạp pool sản phẩm `/products` | Operator export CSV từ dashboard → **Nhập CSV** (`src/lib/products/parse-csv.ts`, action `src/lib/actions/products.ts`) | Cron sync `productOfferV2` → upsert `products` theo `shopee_item_id`. **CSV giữ nguyên làm fallback** (và cho Lazada). |
| Gắn Sub_ID khi duyệt task | `comment_tasks.sub_id_code` sinh ra, `buildTrackedAffiliateUrl()` (`src/lib/worker/affiliate.ts`) nối `?sub_id=<code>` vào `products.affiliate_short_link` | Gọi `generateShortLink` với `subIds: [sub_id_code]` **lúc duyệt task** → link đã attribution sẵn. Cơ chế `AFFILIATE_SUB_ID_PARAM` giữ nguyên cho đường fallback CSV/Lazada. |
| Đối soát conversion | Operator tải CSV báo cáo → `/api/postback/shopee` (tay hoặc relay) + cron `/api/cron/reconcile` (`reconcile_conversions()`) | Cron pull `conversionReport` → ghi thẳng vào `affiliate_conversions` (idempotent theo `external_order_id`). `/api/postback/shopee` và `/api/cron/reconcile` **giữ nguyên** làm đường redundant. |

Không thay đổi mô hình attribution: đơn hàng vẫn match qua
`comment_tasks.sub_id_code = affiliate_conversions.sub_id` — chỉ đổi **nguồn dữ liệu**
từ CSV tay sang API.

---

## 2. Xác minh khu vực — Shopee Việt Nam có Open API không?

Kết luận trung thực: **endpoint VN tồn tại và live** (đã probe trực tiếp), nhưng
**việc một tài khoản affiliate VN có được cấp App ID/Secret hay không chưa xác minh**
(cần thao tác trên dashboard thật). Mức tổng thể: **partial**.

| # | Claim | Mức độ | Bằng chứng |
|---|---|---|---|
| 1 | Endpoint GraphQL của VN là `https://open-api.affiliate.shopee.vn/graphql` | `[Xác minh — probe trực tiếp 2026-10-26]` | `curl -X POST ... -d '{"query":"{__typename}"}'` → HTTP 200 + `{"errors":[{"message":"error [10020]: Invalid Authorization Header","extensions":{"code":10020,...}}]}` — đúng format lỗi GraphQL + đúng mã lỗi 10020 trong bảng mã lỗi, nghĩa là endpoint sống và bắt buộc header `Authorization` SHA256. Cùng query tới BR (`open-api.affiliate.shopee.com.br/graphql`) cho cấu trúc lỗi giống hệt. |
| 2 | Explorer (GraphQL playground) của VN tồn tại | `[Xác minh — probe 2026-10-26]` | `https://open-api.affiliate.shopee.vn/explorer/v2` trả về app shell "Open API Explorer V2" (HTTP 200); BR có `.../explorer` và `.../explorer/v2` với schema hiển thị inline. |
| 3 | Shopee có chương trình Affiliate API chính thức với 3 nhóm ability (offers, short link, conversion/validated report) | `[Xác minh — official, region SG]` | help.shopee.sg/10/article/191702-API-Access. |
| 4 | Publisher lấy App ID + Secret trong dashboard affiliate ở mục **Open API** (mọi region có chương trình trực tiếp, kể cả VN) | `[Xác minh — nguồn thứ cấp nhất quán]` | wecantrack.com/shopee-integration (AppID + Secret key, "Open API" ở cuối menu trái); ce-docs.keywordrush.com/modules/affiliate/shopee (liệt kê affiliate.shopee.vn trong 10 region + hướng dẫn tạo App ID/API Key); apify.com/viralanalyzer/shopee-affiliate-products (BR: Open API panel sau khi được duyệt). |
| 5 | Tài liệu API chính thức nằm trong dashboard: `affiliate.shopee.vn/open_api/list` (cần đăng nhập) | `[Chưa xác minh trực tiếp — SPA, không đọc được không cần đăng nhập]` | Hai repo VN độc lập trích dẫn trang này làm "Nguồn chính thức": github.com/Mai-Nguyen-1007/shopee-aff-api và github.com/bcat95/shopee-aff. `affiliate.shopee.vn/open_api` tồn tại (nginx trả 405 với POST, page serve qua GET). |
| 6 | Quyền truy cập API phải được **yêu cầu/duyệt trước** — gọi không có quyền trả lỗi `10035` | `[Xác minh]` | Bảng mã lỗi trong tài liệu BR (affiliateshopee.com.br/documentacao) và cả hai repo VN: `10035 You currently do not have access to the Shopee Affiliate Open API Platform`. Repo VN kèm link contact form: `help.shopee.vn/portal/webform/c2d6ebc5a2d64dd1b26f8c871730cdbd`. BR mô tả quy trình: vào `affiliate.shopee.com.br/open_api` → "Central de Ajuda" → form email "Quero ativar a API" → nhận credential qua email, "tới 2 tuần". |
| 7 | Endpoint VN hỗ trợ cùng schema operations như BR (productOfferV2, generateShortLink, conversionReport...) | `[Chưa xác minh bằng tài khoản thật]` | Hai repo VN mô tả đúng bộ operations + field giống hệt tài liệu/explorer BR, và ví dụ curl trỏ vào endpoint VN. Khả năng cao schema dùng chung, nhưng **phải chạy smoke test bằng credential thật trước khi tin** (T-SHOPEE-03). |
| 8 | REST "Product API" (`https://open.shopee.vn/openapi/product/v2/product_item_get`, Bearer token) như một số repo VN ghi | `[KHÔNG xác minh — coi như không tồn tại cho tới khi chứng minh được]` | Host `open.shopee.vn` **không phân giải/không kết nối được** từ probe 2026-10-26 (HTTP 000). Shopee Open Platform chính thức dùng `open.shopee.com` / `partner.shopeemobile.com` và là API seller-side. **Không implement phần này.** |
| 9 | Shopee có API AMS (v2.ams.*) trên open.shopee.com | `[Xác minh — nhưng KHÔNG áp dụng]` | open.shopee.com/developer-guide/702 + announcement 1283: AMS Open API là phía **seller/brand** (tạo campaign, quản lý affiliate), cần app type "Affiliate Marketing Solution Management" + shop authorization. Repo này là publisher-side → bỏ qua. |

**Phương án nếu credentials VN không có sẵn** (fallback có thật, không blocking):
1. Vẫn code phần client theo spec BR/VN đã xác minh ở trên — endpoint VN đã live.
2. Trong lúc chờ duyệt, hệ thống chạy nguyên trạng: CSV import + postback relay + reconcile (không mất functionality nào).
3. Nếu region VN bị khóa cứng, chỉ dùng API region khác để **verify phần client/signature** (BR explorer public, schema được xác minh độc lập), không lưu trữ dữ liệu affiliate của region khác vào DB production.

---

## 3. Auth flow

Không có OAuth/access_token cho GraphQL publisher API — xác thực **stateless** bằng
App ID + App Secret ký mỗi request.

- **Credential:** `AppId` (số) + `Secret` (string), lấy trong dashboard affiliate → mục **Open API** (mục 2, dòng 4). `[Xác minh — nguồn thứ cấp]`
- **Header** (thứ tự thành phần linh hoạt, các implementation công khai đều dùng format này):
  ```
  Authorization: SHA256 Credential={AppId}, Timestamp={unixSeconds}, Signature={signature}
  Content-Type: application/json
  ```
  `[Xác minh — nhiều nguồn độc lập: bcat95/shopee-aff (code node/php), snja/shopee-affiliate-openapi (python), affiliateshopee.com.br/documentacao, apify actor doc, github.com/gregojoao/shopee-affiliate]`
- **Signature** — SHA-256 **thường** (không phải HMAC) của chuỗi concatenation, không separator:
  ```
  signature = hex( SHA256( AppId + Timestamp + string(Payload) + Secret ) )
  ```
  `Payload` = **chuỗi JSON body chính xác sẽ gửi đi** (không ép xanh/spaces khác đi — mọi implementation công khai ký `json.dumps(payload)` / `JSON.stringify` rồi gửi đúng payload đó).
  `[Xác minh — công thức lặp lại độc lập ở 5 nguồn; SO question 74877130 còn ghi cả "factor" in ra để debug]`
  ⚠️ Một vài trang (apify FAQ) gọi đây là "HMAC-SHA256" nhưng **công thức và code mẫu đều là SHA-256 thường của chuỗi nối** — implement theo công thức, không theo tên. Verify bằng một call thật duy nhất (T-SHOPEE-02): nếu server trả `10020`, mới thử biến thể HMAC.
- **Timestamp:** Unix **giây** (không phải ms). Sai lệch vài phút → `10020 Request Expired / Invalid Timestamp`. `[Xác minh — affiliateshopee.com.br/documentacao + apify FAQ]`
- **Không có refresh token, không có key rotation công khai** → secret coi như bất biến, chỉ đổi khi Shopee cấp lại. `[Chưa xác minh — quy trình rotate]`
- **Lưu trữ credential trong hệ thống:** một operator duy nhất → để ở env `SHOPEE_AFFILIATE_APP_ID` + `SHOPEE_AFFILIATE_APP_SECRET` (đề xuất tên; chưa có trong `.env.example`, sẽ thêm ở T-SHOPEE-01). Nếu sau này buộc phải lưu DB, dùng đúng pattern AES-256-GCM `v1.<iv>.<tag>.<ct>` đã có của migration `20261024090000_account_credentials.sql` (`ACCOUNT_CREDENTIALS_KEY`) — **không** lưu plaintext, không log secret.

### Mã lỗi GraphQL (extensions.code)
`[Xác minh — bảng mã lỗi cộng gộp từ affiliateshopee.com.br/documentacao + 2 repo VN + gregojoao/shopee-affiliate; mã 10020/10030 đã từng thấy thật từ probe]`

| Code | Nghĩa | Xử lý đề xuất |
|---|---|---|
| 10000 | System Error | Retry với backoff. |
| 10010 | Parse Error (sai cú pháp query) | Không retry — bug phía mình, log full query. |
| 10020 | Invalid Signature / Timestamp / Credential / App disabled | Không retry; alert operator (sai clock hoặc sai secret). |
| 10030 | Rate limit exceeded | Dừng run, retry ở lần cron sau; xem mục 7. |
| 10031–10034 | Access deny / invalid affiliate id / account frozen / blacklisted | Không retry; alert. |
| 10035 | Chưa được cấp quyền Open API Platform | Dừng + hướng dẫn quy trình xin quyền (mục 2.6). |
| 11000 / 11001 / 11002 | Business / Params / Bind Account error | Log, skip row, không crash job. |

Response thành công: `{ "data": { ... } }`; có thể trả `data` + `errors` đồng thời — luôn check cả hai. `[Xác minh — affiliateshopee.com.br/documentacao]`

---

## 4. Endpoints map vào task của hệ thống

Tất cả là `POST /graphql` trên endpoint region (VN ở mục 2). Dưới đây là GraphQL
operations **đã xuất hiện trong tài liệu công khai** (explorer BR + 2 repo VN trùng khớp).

### 4.1 Offer lists → bảng `products`

**`productOfferV2`** — query lấy product offer kèm commission.
`[Xác minh — tài liệu VN (2 repo) + explorer BR công khai: open-api.affiliate.shopee.com.br/explorer/v2 hiển thị inline param docs]`

```
{
  productOfferV2(listType: 0, keyword: "tai nghe bluetooth", sortType: 5, page: 1, limit: 50) {
    nodes {
      itemId productName priceMin priceMax commissionRate sellerCommissionRate
      shopeeCommissionRate commission sales ratingStar imageUrl productCatIds
      shopId shopName shopType productLink offerLink periodStartTime periodEndTime
    }
    pageInfo { page limit hasNextPage scrollId }
  }
}
```

Tham số chính: `listType` (0=all, 2=top performing, 3=landing category, 4=detail category, 5=detail shop — BR explorer còn liệt kê 1=highest commission, 6=detail collection `[Chưa xác minh cho VN]`), `matchId` (categoryId/shopId theo listType), `keyword`, `sortType` (1=relevance, 2=item sold desc, 3=price desc, 4=price asc, 5=commission desc), `page`, `limit`, `shopId`, `itemId`, `productCatId`, `isAMSOffer`, `isKeySeller`.

Field trả về quan trọng: `itemId`, `productName`, `commissionRate` (**String dạng thập phân**: `"0.25"` = 25%), `sellerCommissionRate` + `shopeeCommissionRate` (tách nguồn hoa hồng), `priceMin`/`priceMax` (String tiền tệ), `sales`, `ratingStar`, `imageUrl`, `productLink` (link gốc), `offerLink` (link affiliate dài đã tracking sẵn), `periodStartTime`/`periodEndTime` (Unix — cửa sổ hiệu lực offer!).

**`shopOfferV2`** và **`shopeeOfferV2` / `brandOffer`** — discovery theo shop/chiến dịch.
`[shopeeOfferV2/brandOfferV2: xác minh presence qua code mẫu bcat95 + explorer BR sidebar; tham số chi tiết chỉ xác minh cho shopOfferV2 (repo VN)]` — không dùng trong phase 1.

→ **Mapping vào `products`** (xem mục 5.1): `itemId→shopee_item_id`, `productName→name`,
`commissionRate→commission_rate` (×100), `offerLink→affiliate_short_link`, theo keyword/niche do operator cấu hình.

### 4.2 Generate short link + sub_id → `comment_tasks.sub_id_code`

**`generateShortLink`** (mutation) `[Xác minh — tài liệu VN nêu đích danh endpoint VN, ví dụ curl đầy đủ; cùng schema với BR; snja lib chạy thật với ID/TH]`

```
mutation {
  generateShortLink(input: { originUrl: "https://shopee.vn/....i.<itemId>.<shopId>",
                             subIds: ["<sub_id_code>"] }) { shortLink }
}
```

- `originUrl`: link Shopee gốc (product/shop URL).
- `subIds: [String]` — **tối đa 5 phần tử**; là "Mảng sub id trong **utm content** của tracking link" (nguyên văn tài liệu VN). Response: `shortLink` (vd `https://shope.ee/5XyZ7WqR`).
- `generateBatchShortLink` — mutation tạo nhiều link một lúc, được mô tả bởi apify actor (BR) với template token `{{date}}/{{shopId}}/{{itemId}}/{{keyword}}`; **`[Chưa xác minh cho VN]`** → phase 2, không block.

**Ngữ pháp tracking (quan trọng — ảnh hưởng thiết kế):**

- Sub id đi vào link **qua tham số `subIds` của mutation**, không phải tự nối query string.
  `[Xác minh — tài liệu VN + mọi implementation]`
- Giá trị sub id quay về trong **`utmContent`** của conversion report ("Sub id (giá trị từ sub-id parameter trong affiliate link)").
  `[Xác minh — bảng field ConversionReport, tài liệu VN]`
- **[Chưa xác minh]** việc tự nối `?sub_id=<code>` (cơ chế `AFFILIATE_SUB_ID_PARAM` hiện tại) vào một link `shope.ee` đã sinh bởi API có được Shopee ghi nhận hay không. → Với link sinh qua API: **phải truyền subIds trong mutation**; đường append query string chỉ giữ cho link CSV/Lazada.
- Sub id là free-text; repo hiện enforce `comment_tasks.sub_id_code` unique — giữ nguyên, sinh code ngắn alphanumeric ≤ 32 ký tự (schema hiện enforce max 64 ở postback; `subIds[0]` nên ≤50 để an toàn với utm_content). `[Chưa xác minh — giới hạn length thực tế của subIds]`

### 4.3 Conversion & validated reports → `affiliate_conversions`

**`conversionReport`** — đơn hàng + hoa hồng **ước tính**. `[Xác minh — bảng params/fields đầy đủ ở tài liệu VN; struct query chạy thật trong snja lib]`

```
{
  conversionReport(purchaseTimeStart: <unix>, purchaseTimeEnd: <unix>,
                   orderStatus: "ALL", limit: 500, scrollId: "<cursor>") {
    nodes {
      conversionId purchaseTime clickTime buyerType device referrer utmContent
      sellerCommission shopeeCommissionCapped totalCommission netCommission campaignType
      orders { orderId orderStatus shopType
               items { itemId itemName itemPrice actualAmount qty itemTotalCommission
                       itemSellerCommissionRate itemShopeeCommissionRate
                       fraudStatus displayItemStatus refundAmount attributionType } }
    }
    pageInfo { hasNextPage scrollId }
  }
}
```

Tham số lọc: `purchaseTimeStart/End`, `completeTimeStart/End` (Unix), `shopId`, `shopName`,
`conversionId`, `orderId`, `orderStatus` (`ALL|UNPAID|PENDING|COMPLETED|CANCELLED`),
`buyerType`, `device` (`ALL|APP|WEB`), `fraudStatus`, `productType/categoryType` (DP/MP),
`limit` (**tối đa 500/trang**), `scrollId` (**cursor, TTL 30 giây** — request sau phải gửi lại trong 30s, chỉ dùng một lần). `[Xác minh — lưu ý scrollId 30s ở cả 2 repo VN + affiliateshopee.com.br]`

Điểm thiết kế **bắt buộc chú ý**: 1 node `conversionReport` = 1 **conversion (checkout)**,
bên trong có **nhiều `orders[].orderId`** (thay đổi từ 2023-05-22: trước là 1 checkout = 1 response).
→ Ghi DB phải **phẳng hóa theo `orderId`**, không ghi theo conversionId.
`[Xác minh — Version Update 2023-05-22 trong tài liệu VN]`

**`validatedReport`** — hoa hồng **đã validated/thanh toán**. `[Xác minh]`
Tham số: `validationId` (**bắt buộc**, lấy từ Billing Information trên dashboard), `limit`, `scrollId`.
Fields: tương tự conversionReport + `netCommission` (sau khi trừ MCN fee).
→ Dùng để chuyển conversion sang `settled` với số tiền cuối cùng.

**Trạng thái:** `orderStatus: CANCELLED` → `canceled`; `COMPLETED` → `pending` (chờ validated); validated report khớp conversion → `settled`. Map sang enum `conversion_status` hiện có — không cần thêm enum.

**Không có webhook/postback chính thức từ Shopee cho publisher API** (chỉ có pull report;
wecantrack mô tả tích hợp Shopee là API-based, không có postback URL công khai cho publisher).
→ `/api/postback/shopee` hiện tại vẫn giữ làm đường relay do operator tự điều phối.
`[Chưa xác minh — có thể tồn tại postback riêng trong dashboard; cần kiểm tra trong tài khoản]`

---

## 5. Kiểu dữ liệu đề xuất (mapping field → schema hiện có)

### 5.1 `productOfferV2` → `public.products` (không cần migration cho các cột này)

| Field API | Kiểu API | Cột DB hiện có | Ghi chú chuyển đổi |
|---|---|---|---|
| `itemId` | Int64 | `shopee_item_id text unique` | `String(itemId)`. Upsert key. |
| `productName` | String | `name text not null` | Trim; check length > 0 (constraint sẵn có). |
| `priceMin` (hoặc `priceMax` nếu null) | String ("150000.00") | `price numeric(14,2)` | Parse decimal; **đơn vị tiền tệ VNĐ — không nhân 100**. `[Chưa xác minh — format string thực tế (phân cách/đơn vị) từng region]` → parse tolerate. |
| `commissionRate` | String ("0.25") | `commission_rate numeric(5,2)` (15.5 = 15.5%) | **×100**, clamp 0–100 (constraint sẵn có). Khác CSV parser (nhập "12,5" là 12.5%) — xử lý riêng cho nguồn API. |
| `offerLink` | String | `affiliate_short_link text not null` | Link affiliate dài đã tracking (chưa gắn sub id per-task). |
| `productLink` | String | *(chưa có)* | **Cần migration** (5.3): `origin_link` — nguồn vào của `generateShortLink`. |
| `productCatIds` | [Int] | `niche text` | Không map trực tiếp: cần bảng category id→tên (open question) hoặc operator gán niche. Để null. |

### 5.2 `conversionReport` → `public.affiliate_conversions`

| Field API | Cột DB hiện có | Ghi chú |
|---|---|---|
| `orders[].orderId` (String) | `external_order_id text unique` | **Idempotency key** — upsert theo cột này. Idempotent replay: giữ nguyên hành vi "merge, không ghi đè tiền" như `src/app/api/postback/shopee/route.ts` (status tiến về trước, `canceled` thắng). |
| `utmContent` | `sub_id text not null` | Sub id quay về từ link. Null/rỗng → không match task, vẫn ghi row (như postback hiện tại). |
| (khớp `sub_id` ↔ `comment_tasks.sub_id_code`) | `task_id uuid` | Ghi lúc ingest; nếu chưa có task → để NULL rồi chạy `reconcile_conversions()` như hiện tại. |
| `orders[].actualAmount` (fallback `items[].itemPrice × qty`) | `order_amount numeric(14,2)` | String → number. |
| `totalCommission` (hoặc `netCommission` khi validated) | `estimated_commission numeric(14,2)` | String → number. |
| `orderStatus` | `status conversion_status` | `CANCELLED→canceled`; `COMPLETED/PENDING/UNPAID→pending`; validated report → `settled`. |
| `purchaseTime` (Unix) | `converted_at timestamptz` | Epoch → UTC (server trả epoch, không phụ thuộc TZ; window filter tính theo +07:00 rồi convert). |

### 5.3 Migration cần thêm

**`products`** (phase 1 — optional, không block sync):
`origin_link text`, `shop_id text`, `shop_name text`, `image_url text`, `sales int`,
`rating_star numeric(3,2)`, `seller_commission_rate numeric(5,2)`, `shopee_commission_rate numeric(5,2)`,
`offer_period_end_at timestamptz`, `sync_source text check (in ('csv','api')) default 'csv'`,
`last_synced_at timestamptz`.
(Không bắt buộc phase 1: sync chạy được với 5 cột cũ + `origin_link`; còn lại để phase 2.)

**`comment_tasks`** (phase 1): `affiliate_short_link text` — link đã sinh qua
`generateShortLink` kèm `sub_id_code`, lưu **tại thời điểm duyệt task** để comment/worker
không phải gọi API lúc đăng (idempotent, tránh rate limit lúc claim). Fallback: NULL →
`buildTrackedAffiliateUrl()` như hiện tại.

**`affiliate_conversions`** (phase 1): `external_conversion_id text` (conversionId — 1 conversion
có nhiều order), `click_at timestamptz`, `buyer_type text`, `device text`, `fraud_status text`,
`raw jsonb` (response node — phòng Shopee đổi schema), `synced_at timestamptz`.
Index: `(external_conversion_id)`, `(synced_at desc)`.

**Bảng mới `affiliate_sync_state`** (phase 1): `id pk`, `kind text unique check (in ('conversion','validated','product'))`,
`watermark timestamptz` (purchaseTimeEnd cuối cùng đã ingest), `last_run_at timestamptz`,
`last_error text`, `updated_at`. Lý do: `scrollId` TTL 30s không sống qua các lần cron →
cursor phải **trong run**, còn watermark vĩnh viễn lưu ở DB để run sau không mất/sinh trùng đơn.

Tất cả migration phải cập nhật `src/lib/database.types.ts` (tự sinh bằng `supabase gen types`,
không sửa tay).

---

## 6. Task checklist cho agent code

Thứ tự thực hiện: 01 → 02 → 03 (smoke) → 04/05 song song → 06 → 07/09 → 08 → 10 → 12/13 → 11 → 14.
Task 04–08, 11 chỉ được bật khi T-SHOPEE-03 trả kết quả có credential thật.

- [ ] **T-SHOPEE-01 — Env & quy trình xin credential**
  Thêm `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_APP_SECRET` vào `.env.example` (comment hướng dẫn xin quyền theo mục 2.6); viết `docs` note secret không commit.
  *AC:* app từ chối gọi API khi thiếu env (throw sớm, không silent fail); secret không bao giờ xuất hiện trong log/Telegram alert; `.env.example` có 2 key mới kèm comment.

- [ ] **T-SHOPEE-02 — GraphQL client + signing (`src/lib/shopee/client.ts`)**
  Implement đúng mục 3: `signature = sha256(appId + ts + body + secret)`, header format, timestamp giây, timeout ~15s, parse `errors[].extensions.code`.
  *AC:* unit test with **fixed timestamp + fixed body** so khớp signature hex đã fixture; test JSON body gửi đi là **chuỗi y hệt** phần ký; map lỗi 10020/10030/10035 thành error type phân biệt; không có network call trong unit test.

- [ ] **T-SHOPEE-03 — Smoke probe (`scripts/shopee-probe.ts`)**
  Gọi `productOfferV2(listType: 0, limit: 1)` thật tới `open-api.affiliate.shopee.vn/graphql`.
  *AC:* in HTTP status + `data`/`errors`; exit code khác 0 khi 10020/10035 kèm hướng dẫn xử lý; **kết quả probe thật (paste response) phải được dán vào mục 2 của file này trước khi kích hoạt task 04–08.**

- [ ] **T-SHOPEE-04 — Product sync job (`src/lib/shopee/sync-products.ts` + cron route)**
  Nhận list keyword/niche (env hoặc bảng cấu hình), gọi `productOfferV2`, map theo 5.1, upsert `products` theo `shopee_item_id`.
  *AC:* chạy 2 lần với cùng dữ liệu không tạo duplicate (unique `shopee_item_id` + unique `affiliate_short_link` không bị vi phạm — nếu link offerLink đã tồn tại thì skip/merge); `commission_rate` "0.25"→25.0 có test; row CSV cũ không bị xoá (`is_active` giữ nguyên); parser CSV hiện tại vẫn hoạt động bình thường (không regress test `parse-csv`).

- [ ] **T-SHOPEE-05 — Migration products extra columns (5.3)**
  *AC:* migration apply sạch trên CI schema check (`supabase/ci/verify-schema.mjs` pass); `database.types.ts` regenerated; rollback note trong header migration.

- [ ] **T-SHOPEE-06 — Short link per task (`generateShortLink`)**
  Tại luồng duyệt task (nơi `sub_id_code` được sinh): gọi mutation với `originLink` của `matched_product_id` + `subIds: [sub_id_code]`, lưu vào `comment_tasks.affiliate_short_link`; worker dùng link này khi đăng.
  *AC:* task được duyệt → có `affiliate_short_link` bắt đầu bằng `http` và API được gọi **một lần** (không gọi lại khi claim); khi API lỗi/10035 → fallback `buildTrackedAffiliateUrl(products.affiliate_short_link, sub_id_code)` + ghi `execution_note`; có test integration mock GraphQL.

- [ ] **T-SHOPEE-07 — Conversion pull job (`/api/cron/shopee/conversions`)**
  Pull cửa sổ `purchaseTimeStart = watermark`, paginate `limit=500` + `scrollId` trong vòng 30s, phẳng hóa `orders[]` → upsert `affiliate_conversions` theo `external_order_id` (merge semantics giống postback route: không ghi đè tiền, status tiến về trước), update watermark = `purchaseTimeEnd` đã xử lý.
  *AC:* replay cùng cửa sổ không sinh duplicate (test với fixture 2 order/1 conversion → đúng 2 row, `external_conversion_id` chung); row có `sub_id` khớp `sub_id_code` được gắn `task_id` ngay; `raw` jsonb lưu nguyên node; route bảo vệ bằng `authorizeCron` (401 khi thiếu secret).

- [ ] **T-SHOPEE-08 — Validated report → `settled`**
  Pull `validatedReport(validationId)` (validationId do operator nhập/cấu hình), khớp `external_conversion_id`, chuyển status sang `settled`, cập nhật `estimated_commission` = `netCommission`.
  *AC:* conversion chưa tồn tại không crash (log + skip); `pending→settled` có test; `canceled` không bị hạ cấp lại.

- [ ] **T-SHOPEE-09 — `affiliate_sync_state` migration + resume logic (5.3)**
  *AC:* kill job giữa chừng (test mô phỏng) → run sau resume từ watermark, không mất/không trùng đơn; `last_error` hiển thị được khi fail; migration + types regenerated.

- [ ] **T-SHOPEE-10 — Lịch cron + cấu hình**
  Đăng ký route mới vào `vercel.json`/cron config, tần suất đề xuất: conversions 30–60 phút, products 6–24 giờ (tùy keyword), validated report 1 lần/ngày (sau khi Shopee update billing).
  *AC:* mọi route dùng chung `authorizeCron`; document tần suất + lý do trong README; không có hot loop (một run ≤ N request, N cấu hình được).

- [ ] **T-SHOPEE-11 — UI: hiển thị nguồn sync**
  `/products` (badge CSV/API + `last_synced_at`), `/analytics` (external order id, `buyer_type`, `fraud_status`), task detail (link Shopee sinh qua API).
  *AC:* null-safe (row CSV cũ không có field mới không vỡ trang); có test component tối thiểu theo pattern repo.

- [ ] **T-SHOPEE-12 — Đối soát: tích hợp pull + reconcile hiện có**
  Sau mỗi run conversions → gọi rpc `reconcile_conversions()`; giữ nguyên `/api/cron/reconcile` và `/api/postback/shopee`.
  *AC:* đơn về trễ (sub_id_code sinh sau conversion) vẫn được attach ở lần pull/reconcile kế tiếp (test end-to-end với fixture); không có double-count khi cả postback lẫn pull cùng ghi cùng `external_order_id`.

- [ ] **T-SHOPEE-13 — Rate limit & backoff**
  Khi gặp 10030 hoặc HTTP 429: dừng run ngay, ghi `last_error`, để lần cron sau chạy tiếp; exponential backoff cho 10000; single-flight lock (không 2 run song song) qua `worker_heartbeats` hoặc advisory lock.
  *AC:* test mô phỏng 10030 giữa chừng → job thoát sạch, watermark đã ingest giữ nguyên; log có request count mỗi run để quan sát hạn mức.

- [ ] **T-SHOPEE-14 — README + đóng gap #15 (có điều kiện)**
  Cập nhật README: 2 đường nạp sản phẩm (API sync + CSV fallback), 2 đường conversion (pull + postback/reconcile), hướng dẫn xin credential Shopee.
  *AC:* README ghi rõ trạng thái "đã smoke test bằng credential thật" **chỉ khi** T-SHOPEE-03 pass; nếu chưa có credential, ghi "pending access request" — không tuyên bố tích hợp production khi chưa verify.

---

## 7. Open questions & rủi ro

1. **Credential VN chưa có trong tay** (rủi ro lớn nhất): endpoint live nhưng cấp quyền theo thủ công, BR mô tả "tới 2 tuần". → Mọi task 04–11 phải sau smoke test. Trạng thái hiện tại: pending access request.
2. **Rate limit cụ thể không công khai**: chỉ biết mã 10030. Giới hạn thực tế (req/phút) `[Chưa xác minh]` → mặc định an toàn: ≤1 req/giây, reports limit=500 (1 trang/run đầu), offers limit ≤ 50, theo dõi request count mỗi run (T-SHOPEE-13).
3. **Schema VN == BR?** Tài liệu VN (2 repo) và explorer BR khớp nhau từng field, nhưng chưa có explorer/doc VN public đọc được. → Smoke test sẽ xác nhận từng operation; nếu operation nào lỗi 10010 (parse/unknown field) thì giảm field xuống tối thiểu và cập nhật file này.
4. **`utmContent` trả về 1 chuỗi duy nhất** trong khi subIds nhận tối đa 5 phần tử → format join (phân cách bằng gì?) `[Chưa xác minh]`. Thiết kế hiện tại chỉ dùng `subIds[0]` = `sub_id_code` để tránh ambiguity; các slot còn lại để trống.
5. **Độ trễ conversion**: report có độ trễ (không publish SLA) `[Chưa xác minh]` → window pull nên lùi lại (vd watermark − 2h) để tránh miss đơn chưa kịp hiện; idempotency theo `external_order_id` đã bảo vệ.
6. **Currency/format price**: `priceMin`/`itemPrice` là String tiền tệ local — format chính xác (có phân cách nghìn?) `[Chưa xác minh]` → parser tolerant + fixture thật từ smoke test.
7. **Credential storage**: env là đủ cho 1 operator; nếu phải lưu DB thì AES-256-GCM theo pattern `account_credentials`. Không bao giờ log secret; alert chỉ nêu "10020 – kiểm tra secret/clock".
8. **API thay đổi / deprecation**: lịch sử update cho thấy field gắn nhãn "New"/"To Be Remove" theo từng mốc (2023-05-22, 2023-08-04, 2024-11-15). → Lưu `raw jsonb`, chỉ phụ thuộc các field cốt lõi (itemId, commissionRate, offerLink, utmContent, orderId, totalCommission); tái xem xét tài liệu mỗi quý.
9. **Region lock / điều khoản**: dùng API phải tuân thủ ToS Shopee Affiliate `[Chưa xác minh — đọc ToS trước khi scale]`; không scrape, không share credential.
10. **Không có postback chính thức cho publisher** `[Chưa xác minh]` — nếu sau này có trong dashboard thì chuyển sang dual-source (postback real-time + pull đối soát), schema DB đã sẵn sàng cho cả hai.

---

## 8. Nguồn tham khảo

Ngày tra tất cả: **2026-10-26**.

**Chính thức (Shopee):**
- https://help.shopee.sg/10/article/191702-API-Access — Help Center SG: 3 nhóm ability của Shopee Affiliate API (offer lists, short link, conversion & validated reports).
- https://help.shopee.vn/10/article/152867 — Help Center VN "Hướng dẫn sử dụng hệ thống Shopee Affiliate" (không nhắc API — chỉ mô tả dashboard chuyển đổi link).
- https://open-api.affiliate.shopee.vn/graphql — endpoint VN. **Probe 2026-10-26:** HTTP 200 + GraphQL error `10020 Invalid Authorization Header` (không credentials).
- https://open-api.affiliate.shopee.vn/explorer/v2 — Explorer V2 của VN (HTTP 200, app shell).
- https://open-api.affiliate.shopee.com.br/explorer và https://open-api.affiliate.shopee.com.br/explorer/v2 — Explorer BR (GraphQL playground public, hiển thị inline param/field docs của `productOfferV2`, `shopeeOfferV2`, `shopOfferV2`).
- https://affiliate.shopee.com.br/open_api — dashboard Open API BR (nơi lấy App ID/Secret + quy trình xin quyền qua form email).
- https://help.shopee.vn/portal/webform/c2d6ebc5a2d64dd1b26f8c871730cdbd — form liên hệ VN được trích trong bảng mã lỗi 10035 của tài liệu tổng hợp VN.
- https://open.shopee.com/developer-guide/702 và https://open.shopee.com/announcements/1283 — AMS Open API (seller/brand-side, **không áp dụng** cho repo này; ghi để không nhầm lẫn hai nền tảng).

**Thứ cấp / cộng đồng (dùng để dựng spec, mỗi mục đã đối chiếu chéo):**
- https://github.com/Mai-Nguyen-1007/shopee-aff-api — tài liệu API Shopee Affiliate tổng hợp theo tài liệu dashboard VN (`affiliate.shopee.vn/open_api/list`): params/fields đầy đủ của `productOfferV2`, `shopOfferV2`, `generateShortLink`, `conversionReport`, `validatedReport`, bảng mã lỗi, lịch sử update.
- https://github.com/bcat95/shopee-aff và https://github.com/bcat95/shopee-aff/blob/main/Code/nodejs/index.js — bản VN tương đương + code Node/PHP thật (công thức ký, endpoint VN, ví dụ response). Lưu ý: mục "Product APIs (REST) `open.shopee.vn`" trong repo này **không xác minh được** (host không kết nối) → loại.
- https://github.com/snja/shopee-affiliate-openapi/blob/master/shopee_affiliate/__init__.py — client Python chạy thật với endpoint ID/TH: ký `sha256(appid+ts+json+secret)`, pagination `scrollId` cho `conversionReport`, max limit 500.
- https://www.affiliateshopee.com.br/documentacao — playground không chính thức (BR), công thức signature, cấu trúc response `data/errors`, bảng mã lỗi, lưu ý scrollId TTL 30s, hướng dẫn xin quyền.
- https://stackoverflow.com/questions/74877130/ — "Invalid Signature": in chuỗi ký ra debug, khẳng định `f'{appID}{timestamp}{payload}{secret}'` + SHA256 thường.
- https://plugins.svn.wordpress.org/manilastack-affiliate-boxes-sea/trunk/includes/class-seabox-shopee-client.php và https://wordpress.org/plugins/manilastack-affiliate-boxes-sea — plugin WP production: danh sách endpoint per-region (VN, PH, MY, TH, ID, SG, TW…), cơ chế chọn endpoint theo domain sản phẩm.
- https://ce-docs.keywordrush.com/modules/affiliate/shopee — hướng dẫn lấy App ID + API Key từ dashboard Open API, liệt kê 10 region kể cả VN; API chỉ trả title/image/price cơ bản.
- https://wecantrack.com/shopee-integration — tích hợp publisher Shopee qua App ID + Secret ("Open API" ở menu trái), tracking qua SubID, mô tả tích hợp Shopee là API-based (không postback công khai).
- https://apify.com/viralanalyzer/shopee-affiliate-products — actor BR: `generateBatchShortLink`, template token subIds, công thức signature, "offerLink = link dài tracking sẵn".
- https://github.com/gregojoao/shopee-affiliate (NuGet Shopee.Affiliate) — phân loại exception theo mã lỗi (10020/10030/10035, HTTP 401/403/429).
