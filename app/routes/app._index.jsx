import { useEffect, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const sales = await db.layawaySale.findMany({
    where: { shop: session.shop },
    include: { installments: { orderBy: { paidAt: "desc" } } },
    orderBy: { initialDate: "desc" },
  });

  return { sales: sales.map(serializeSale) };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "lookup-order") {
    try {
      const order = await findOrder(admin, formData.get("orderNumber"));
      return order ? { order } : { error: "Enter a valid Shopify order number, such as #1001." };
    } catch {
      return { error: "Shopify could not look up that order. Reauthorize the app and try again." };
    }
  }

  if (intent === "create") {
    let order;
    try {
      order = await findOrder(admin, formData.get("orderNumber"));
    } catch {
      return { error: "Shopify could not validate that order. Reauthorize the app and try again." };
    }
    const downPaymentCents = toCents(formData.get("downPayment"));
    const initialDate = new Date(`${formData.get("initialDate")}T12:00:00`);

    if (!order || downPaymentCents === null || Number.isNaN(initialDate.getTime())) {
      return { error: "Enter a valid Shopify order number, date, and down payment." };
    }
    if (downPaymentCents < 0 || downPaymentCents > order.totalCents) {
      return { error: "The total must be positive and the down payment cannot exceed it." };
    }

    await db.layawaySale.create({
      data: {
        shop: session.shop,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        orderReference: String(formData.get("orderReference") || "").trim() || null,
        initialDate,
        totalCents: order.totalCents,
        downPaymentCents,
      },
    });
    return { success: "Layaway sale created." };
  }

  if (intent === "payment") {
    const saleId = Number(formData.get("saleId"));
    const amountCents = toCents(formData.get("amount"));
    const paidAt = new Date(`${formData.get("paidAt")}T12:00:00`);
    const sale = await db.layawaySale.findFirst({
      where: { id: saleId, shop: session.shop },
      include: { installments: true },
    });
    if (!sale || amountCents === null || amountCents <= 0 || Number.isNaN(paidAt.getTime())) {
      return { error: "Enter a valid payment amount and date." };
    }
    const remainingCents = balanceFor(sale);
    if (amountCents > remainingCents) {
      return { error: `Payment cannot exceed the remaining ${formatMoney(remainingCents)}.` };
    }
    await db.layawayInstallment.create({
      data: { saleId, amountCents, paidAt, note: String(formData.get("note") || "").trim() || null },
    });
    return { success: "Installment recorded." };
  }

  if (intent === "cancel") {
    const saleId = Number(formData.get("saleId"));
    const sale = await db.layawaySale.findFirst({ where: { id: saleId, shop: session.shop } });
    if (!sale) return { error: "The layaway sale could not be found." };
    await db.layawaySale.delete({ where: { id: sale.id } });
    return { success: `Layaway record for order ${sale.orderNumber} was deleted.` };
  }

  return { error: "Unsupported request." };
};

export default function Index() {
  const { sales } = useLoaderData();
  const actionData = useActionData();
  const orderFetcher = useFetcher();
  const today = new Date().toISOString().slice(0, 10);
  const [orderNumber, setOrderNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [total, setTotal] = useState("");

  useEffect(() => {
    if (orderFetcher.data?.order) {
      setOrderNumber(orderFetcher.data.order.orderNumber);
      setCustomerName(orderFetcher.data.order.customerName);
      setTotal((orderFetcher.data.order.totalCents / 100).toFixed(2));
    }
  }, [orderFetcher.data]);

  return (
    <s-page heading="Layaway sales">
      {actionData?.error && <s-banner tone="critical">{actionData.error}</s-banner>}
      {actionData?.success && <s-banner tone="success">{actionData.success}</s-banner>}
      <s-section heading="New layaway sale">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-text-field label="Shopify order number" name="orderNumber" placeholder="#1001" value={orderNumber} onInput={(event) => setOrderNumber(event.currentTarget.value)} required />
              <s-button type="button" onClick={() => orderFetcher.submit({ intent: "lookup-order", orderNumber }, { method: "post" })} {...(orderFetcher.state !== "idle" ? { loading: true } : {})}>Find order</s-button>
            </s-stack>
            {orderFetcher.data?.error && <s-banner tone="critical">{orderFetcher.data.error}</s-banner>}
            <s-text-field label="Customer" name="customerName" value={customerName} disabled />
            <s-text-field label="Internal reference (optional)" name="orderReference" />
            <label>
              <s-text>Initial date</s-text>
              <input name="initialDate" type="date" defaultValue={today} required />
            </label>
            <s-text-field label="Total sale amount" name="total" type="number" value={total} disabled />
            <s-text-field label="Down payment" name="downPayment" type="number" min="0" step="0.01" value="0" required />
            <s-button type="submit" variant="primary">Create layaway sale</s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="Active layaway sales">
        {sales.length === 0 ? (
          <s-paragraph>No layaway sales have been recorded yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="large">
            {sales.map((sale) => (
              <s-box key={sale.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <s-heading>{sale.orderNumber} - {sale.customerName}</s-heading>
                  <s-paragraph>
                    Started {sale.initialDate} | Total {formatMoney(sale.totalCents)} | Down payment {formatMoney(sale.downPaymentCents)} | {sale.installments.length} installments recorded | Remaining {formatMoney(sale.remainingCents)}
                  </s-paragraph>
                  {sale.orderReference && <s-paragraph>Reference: {sale.orderReference}</s-paragraph>}
                  {sale.installments.length > 0 && (
                    <s-unordered-list>
                      {sale.installments.map((installment) => (
                        <s-list-item key={installment.id}>{installment.paidAt}: {formatMoney(installment.amountCents)}{installment.note ? ` - ${installment.note}` : ""}</s-list-item>
                      ))}
                    </s-unordered-list>
                  )}
                  {sale.remainingCents > 0 && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="payment" />
                      <input type="hidden" name="saleId" value={sale.id} />
                      <s-stack direction="inline" gap="base">
                        <s-text-field label="Payment amount" name="amount" type="number" min="0.01" max={(sale.remainingCents / 100).toFixed(2)} step="0.01" required />
                        <label>
                          <s-text>Payment date</s-text>
                          <input name="paidAt" type="date" defaultValue={today} required />
                        </label>
                        <s-text-field label="Note (optional)" name="note" />
                        <s-button type="submit">Record payment</s-button>
                      </s-stack>
                    </Form>
                  )}
                  <Form method="post">
                    <input type="hidden" name="intent" value="cancel" />
                    <input type="hidden" name="saleId" value={sale.id} />
                    <s-button type="submit" tone="critical">Cancel and delete layaway record</s-button>
                  </Form>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

function toCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function balanceFor(sale) {
  return sale.totalCents - sale.downPaymentCents - sale.installments.reduce((total, installment) => total + installment.amountCents, 0);
}

function formatMoney(cents) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

async function findOrder(admin, input) {
  const orderNumber = normalizeOrderNumber(input);
  if (!orderNumber) return null;
  const response = await admin.graphql(
    `#graphql
      query findLayawayOrder($query: String!) {
        orders(first: 1, query: $query) {
          nodes {
            name
            customer { displayName }
            currentTotalPriceSet { shopMoney { amount } }
          }
        }
      }`,
    { variables: { query: `name:${orderNumber}` } },
  );
  const result = await response.json();
  const order = result.data?.orders?.nodes?.[0];
  if (!order || order.name !== orderNumber || !order.customer?.displayName) return null;
  const totalCents = toCents(order.currentTotalPriceSet?.shopMoney?.amount);
  return totalCents !== null && totalCents > 0 ? { orderNumber: order.name, customerName: order.customer.displayName, totalCents } : null;
}

function normalizeOrderNumber(value) {
  const number = String(value || "").trim();
  return /^#\d+$/.test(number) ? number : null;
}

function serializeSale(sale) {
  return {
    ...sale,
    initialDate: sale.initialDate.toISOString().slice(0, 10),
    remainingCents: balanceFor(sale),
    installments: sale.installments.map((installment) => ({ ...installment, paidAt: installment.paidAt.toISOString().slice(0, 10) })),
  };
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
