import { sql } from "./db";

// Demo order store. For a real client this module is the only thing that
// changes: swap the SQL for a Shopify Admin API (GraphQL) orders query.

export type OrderSummary = {
  orderNumber: string;
  status: "processing" | "shipped" | "delivered" | "cancelled";
  placedAt: string;
  items: { name: string; size: string; qty: number }[];
  total: string;
  shippingMethod: string;
  shipTo: string; // city + country only, never the full address
  carrier: string | null;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  deliveredAt: string | null;
};

export type LookupResult =
  | { found: true; order: OrderSummary }
  | { found: false; reason: "no_match" | "invalid_input" };

export function normalizeOrderNumber(raw: string): string {
  // Accept "1042", "#1042", "ka1042", "KA-1042"
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? `KA-${digits}` : "";
}

/**
 * Looks up an order. The email must match the order's email — otherwise we
 * return exactly what a wrong order number returns, so the agent can never
 * reveal whether someone else's order exists.
 */
export async function lookupOrder(
  store: string,
  rawOrderNumber: string,
  rawEmail: string
): Promise<LookupResult> {
  const orderNumber = normalizeOrderNumber(rawOrderNumber);
  const email = rawEmail.trim().toLowerCase();
  if (!orderNumber || !email.includes("@")) return { found: false, reason: "invalid_input" };

  const rows = await sql`
    SELECT order_number, email, status, items, total, shipping_method, ship_city, ship_country,
           carrier, tracking_number,
           -- dates as text so they never shift with the server time zone
           placed_at::text AS placed_at, estimated_delivery::text AS estimated_delivery,
           delivered_at::text AS delivered_at
    FROM orders WHERE store = ${store} AND order_number = ${orderNumber} LIMIT 1
  `;
  const r = rows[0];
  // Wrong number and wrong email return the identical result on purpose.
  if (!r || String(r.email).toLowerCase() !== email) return { found: false, reason: "no_match" };

  return {
    found: true,
    order: {
      orderNumber: r.order_number,
      status: r.status,
      placedAt: r.placed_at,
      items: r.items,
      total: `$${Number(r.total).toFixed(2)}`,
      shippingMethod: r.shipping_method,
      shipTo: `${r.ship_city}, ${r.ship_country}`,
      carrier: r.carrier,
      trackingNumber: r.tracking_number,
      estimatedDelivery: r.estimated_delivery,
      deliveredAt: r.delivered_at,
    },
  };
}
