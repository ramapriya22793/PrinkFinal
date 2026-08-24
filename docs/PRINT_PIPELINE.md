# THE PRINK — Personalisation & Print Pipeline

How a customer photo becomes a print-ready file, and why the preview the
customer sees is the same composition that reaches the press.

## 1. The one-model rule

The hard requirement is:

> customer preview == admin preview == print output

That is only achievable if there is exactly **one** definition of "where the
photo sits", expressed in units that do not depend on resolution. Two modules
implement it and must be changed together:

| File | Role |
|---|---|
| [`server/utils/designTransform.js`](../server/utils/designTransform.js) | Canonical model + placement maths (server) |
| [`apps/customer/src/lib/designTransform.ts`](../apps/customer/src/lib/designTransform.ts) | Byte-for-byte mirror of the same units (browser) |

### Transform units

| Field | Unit | Meaning |
|---|---|---|
| `scale` | multiplier | `1` exactly fills the print area ("cover" fit) |
| `offsetX` / `offsetY` | **fraction of the print area** | `0.1` = shift by 10% of its width |
| `rotation` | degrees clockwise | about the print-area centre |
| `brightness` / `contrast` | percent, `100` = unchanged | matches CSS `filter()` |

**Offsets are fractional, never pixels.** A 150px nudge in a 400px-wide phone
preview and in a 3600px print canvas are completely different shifts — that is
precisely how a preview drifts from its print file. The previous
implementation stored pixel offsets; `fromLegacyImage()` migrates those records
by dividing by the old fixed 500px preview canvas.

This property is pinned by a test — *"placement is resolution independent"* in
[`server/tests/designTransform.test.js`](../server/tests/designTransform.test.js).

## 2. Template configuration

Geometry lives in [`server/config/printTemplates.js`](../server/config/printTemplates.js),
served to every client via `GET /api/templates/resolve?sku=…`.

```js
{
  id: 'tpl-frame-8x10',
  match: ['frame', 'decor', 'frm'],       // matched against SKU / type / title
  mockupUrl: '/uploads/frame_mockup.png', // preview backdrop, never printed
  printArea: { x: 0.215, y: 0.165, w: 0.57, h: 0.655 },  // NORMALISED 0..1
  physical: { widthMm: 203.2, heightMm: 254, bleedMm: 3, safeMm: 6 },
  dpi: 300,
  minSourcePx: 1800,   // reject softer photos up front
  maxImages: 1
}
```

`printArea` is normalised so the browser multiplies it by the on-screen mockup
size while the renderer multiplies it by the full 300-DPI canvas. **No pixel
coordinates appear in any frontend component.**

### Resolution order

1. An admin SKU→template assignment (a `Template` document whose `skuMapping`
   contains the SKU and which carries a `printArea`)
2. Keyword match on SKU / product type / product title
3. The fallback template

Adding a normal product therefore requires **no code change** — create the
template document and assign the SKU.

> `match` lists abbreviations (`frm`, `tsh`, `cal-`) alongside full words. Real
> SKUs look like `PRK-FRM-810`; without the abbreviation the SKU silently fell
> through to the fallback template and printed at the wrong physical size.

## 3. Upload → print

```
Shopify orders/create ──HMAC verified──▶ workflow + hashed upload token
        │
        ▼
WhatsApp link  https://…/upload/<token>
        │
        ▼
GET  /api/public/order/:token            → order + resolved template
POST /api/public/order/:token/upload     → ORIGINAL stored + preview derivative
PATCH …/image/:imageId                   → save exact transform (debounced)
POST …/confirm                           → lock design, render print file
        │
        ▼
admin review ──▶ printer queue ──▶ production statuses
```

### Original preservation

| Path | Contents |
|---|---|
| `server/uploads/originals/` | the untouched customer file |
| `server/uploads/previews/` | 1400px JPEG, preview only |
| `server/uploads/print/` | generated print PDFs |

Editing is **non-destructive**: only transform metadata is stored. The renderer
always reads `originalKey`, never the preview. `resolveOriginalPath()` confines
resolution to the uploads directory so a stored key cannot traverse the
filesystem (covered by a test).

## 4. Print output — what is and is not guaranteed

[`server/utils/printRenderer.js`](../server/utils/printRenderer.js) reconstructs
the design from *original + template + transform*. It never upscales the
browser preview.

**Verified by tests:**

- Output raster is the template's exact full-bleed pixel size
  (8×10in @ 300 DPI = 2400×3000 trim pixels)
- PNG carries a 300 DPI density tag
- PDF page size is the true physical size including bleed (209.2 × 260 mm)
- Crop marks are drawn at the trim box
- Canvas size is driven by the template, **not** the source image; an
  under-resolution photo yields a correctly sized file plus a
  `belowMinimumDpi` flag rather than a small one
- A missing original throws instead of emitting a blank sheet

### ⚠️ Colour space: RGB, not CMYK

PDFKit emits **DeviceRGB**. `generatePrintPdf()` therefore reports
`colourSpace: 'RGB'` and the code does not claim otherwise.

Genuine CMYK separation needs an ICC toolchain (e.g. Ghostscript with an output
profile, or `sharp` built against a CMYK-capable libvips). **This is not
installed and has not been implemented.** Do not label the current output CMYK.
To add it, post-process in `generatePrintPdf()`:

```
gs -dNOPAUSE -dBATCH -sDEVICE=pdfwrite \
   -sColorConversionStrategy=CMYK -dProcessColorModel=/DeviceCMYK \
   -sOutputICCProfile=<press-profile>.icc -sOutputFile=out.pdf in.pdf
```

Confirm the required press profile with the print vendor first.

## 5. Idempotency

- **Webhooks** — the `X-Shopify-Webhook-Id` is claimed via a unique index
  before processing, so a Shopify retry is acknowledged without creating a
  second workflow.
- **Confirm design** — a conditional update on `designLockedAt` claims the
  order. A double click returns `alreadyConfirmed: true` and never queues a
  second print job.
- **Concurrent uploads** — images are appended with `$push`, not a
  read-modify-write, so simultaneous uploads cannot clobber each other.

## 6. Access control

Roles are `customer`, `admin`, `printer`, enforced server-side on every route.

| Rule | Why |
|---|---|
| `/register` always creates a **customer** | it previously honoured `role` from the body, so anyone could POST `{"role":"admin"}` |
| `/admin-login` and `/printer-login` verify the password **and** the stored role | neither checked the password at all; `/admin-login` auto-created an admin for any unknown email |
| An account with no password hash can never log in | the old check was `hash ? compare : true`, so any password worked |
| The **first** admin only can be bootstrapped via `/admin-login` | once one admin exists the path closes; further staff come from `POST /api/users` |
| Printers have no self-signup | anyone able to create a printer account could read every approved design |
| `GET /api/orders`, `/api/orders/:id`, `/api/settings` are admin-only | they served customer PII, and settings returned the live Shopify Admin token |
| Secrets are masked in `GET /api/settings` | the UI only needs `…Configured: true/false`; a blank value on save means "unchanged" |
| Printers may only set whitelisted production statuses | the request body can never reach artwork fields, and stage skipping is refused |
| 5xx responses return a generic message | raw errors leak paths, connection strings and driver internals |

The upload portal is the one deliberately unauthenticated surface: the token in
the URL *is* the credential. It is 32 random bytes, stored SHA-256 hashed, with
an expiry, and every response is trimmed so no Shopify or admin data crosses
that boundary.

## 7. Notifications

WhatsApp is optional. With `WHATSAPP_API_URL`/`WHATSAPP_ACCESS_TOKEN` unset the
message is **recorded** and the API returns `delivered: false` — it never
claims a message was sent when it was not. Every message carries a dedupe key
(`order + kind + day`) backed by a unique index, so a double click or a retried
job cannot send twice, and a provider outage never corrupts the order.

## 8. Running the tests

```bash
cd server && npm test
```

Uses `mongodb-memory-server`, so no external database is required.
80 tests cover the transform model, the renderer, the full
webhook → upload → confirm → approve → print-floor flow, the authorisation
boundaries, the authentication vulnerabilities listed above, and the
data-exposure regressions.
