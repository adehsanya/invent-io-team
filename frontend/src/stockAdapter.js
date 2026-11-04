// Everything the app assumes about stock and refund API shapes lives in this file.
// Request bodies follow the backend OpenAPI document (AdjustStockDto, SetThresholdDto, RefundDto).
// Response shapes are NOT documented yet, so the readers below are tolerant guesses;
// confirm them with the backend and tighten here only.

const rowsOf = (body) =>
  Array.isArray(body) ? body : body?.items || body?.stock || body?.levels || [];

const qtyOf = (row) => {
  const q = row?.quantity ?? row?.qty ?? row?.onHand ?? row?.cachedQty ?? row?.stock;
  return q == null || q === "" || Number.isNaN(Number(q)) ? null : Number(q);
};

export function stockByProduct(body) {
  const map = {};
  for (const row of rowsOf(body)) {
    const id = row.productId || row.product?.id;
    const qty = qtyOf(row);
    if (id && qty != null)
      map[id] = { qty, threshold: row.lowStockThreshold ?? row.threshold ?? null };
  }
  return map;
}

export function restockBody({ branchId, productId, qty }) {
  return { branchId, productId, type: "RESTOCK", qtyDelta: qty, reason: "Received stock" };
}

export function correctionBody({ branchId, productId, current, target }) {
  return {
    branchId,
    productId,
    type: "ADJUSTMENT",
    qtyDelta: target - current,
    reason: "Count corrected",
  };
}

// No "items" means refund the whole remaining sale (RefundDto).
export const voidBody = (reason) => (reason ? { reason } : {});

export function wholeNumber(text) {
  const t = String(text ?? "").trim();
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

export function stockLabel(info, threshold) {
  if (!info) return null;
  if (info.qty < 0) return { tone: "warn", text: "Check count · " + info.qty };
  if (info.qty === 0) return { tone: "bad", text: "Out of stock" };
  const t = threshold ?? info.threshold;
  if (t > 0 && info.qty <= t) return { tone: "warn", text: "Low · " + info.qty + " left" };
  return { tone: "ok", text: info.qty + " in stock" };
}
