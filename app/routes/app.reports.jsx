/* eslint-disable react/prop-types */
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const start = parseDate(url.searchParams.get("start"));
  const end = parseDate(url.searchParams.get("end"), true);
  const outstandingStart = parseDate(url.searchParams.get("outstandingStart"));
  const outstandingEnd = parseDate(url.searchParams.get("outstandingEnd"), true);
  const outstandingOrderNumber = String(url.searchParams.get("outstandingOrderNumber") || "").trim();
  const outstandingCustomerName = String(url.searchParams.get("outstandingCustomerName") || "").trim();
  const [completedSales, outstandingSales] = await Promise.all([
    db.layawaySale.findMany({
    where: {
      shop: session.shop,
      ...(start || end ? { initialDate: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    },
    include: { installments: { orderBy: { paidAt: "asc" } } },
    orderBy: { initialDate: "desc" },
    }),
    db.layawaySale.findMany({
      where: {
        shop: session.shop,
        ...(outstandingOrderNumber ? { orderNumber: { contains: outstandingOrderNumber } } : {}),
        ...(outstandingCustomerName ? { customerName: { contains: outstandingCustomerName } } : {}),
        ...(outstandingStart || outstandingEnd ? { initialDate: { ...(outstandingStart ? { gte: outstandingStart } : {}), ...(outstandingEnd ? { lte: outstandingEnd } : {}) } } : {}),
      },
      include: { installments: { orderBy: { paidAt: "asc" } } },
      orderBy: { initialDate: "desc" },
    }),
  ]);
  const completed = completedSales.map(serializeSale);
  const outstanding = outstandingSales.map(serializeSale);
  return {
    start: url.searchParams.get("start") || "",
    end: url.searchParams.get("end") || "",
    outstandingStart: url.searchParams.get("outstandingStart") || "",
    outstandingEnd: url.searchParams.get("outstandingEnd") || "",
    outstandingOrderNumber,
    outstandingCustomerName,
    outstanding: outstanding.filter((sale) => sale.remainingCents > 0),
    completed: completed.filter((sale) => sale.remainingCents === 0),
  };
};

export default function Reports() {
  const { start, end, outstandingStart, outstandingEnd, outstandingOrderNumber, outstandingCustomerName, outstanding, completed } = useLoaderData();
  return (
    <s-page heading="Layaway reports">
      <s-section heading="Find outstanding layaway transactions">
        <Form method="get">
          <s-stack direction="block" gap="base">
            <s-text-field label="Shopify order number" name="outstandingOrderNumber" value={outstandingOrderNumber} placeholder="#1001" />
            <s-text-field label="Customer name" name="outstandingCustomerName" value={outstandingCustomerName} />
            <s-stack direction="inline" gap="base">
              <label>
                <s-text>Initial date from</s-text>
                <input name="outstandingStart" type="date" defaultValue={outstandingStart} />
              </label>
              <label>
                <s-text>Initial date to</s-text>
                <input name="outstandingEnd" type="date" defaultValue={outstandingEnd} />
              </label>
              <s-button type="submit" variant="primary">Search outstanding</s-button>
              <s-button href="/app/reports">Clear</s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="Completed transaction range">
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <label>
              <s-text>From</s-text>
              <input name="start" type="date" defaultValue={start} />
            </label>
            <label>
              <s-text>To</s-text>
              <input name="end" type="date" defaultValue={end} />
            </label>
            <s-button type="submit" variant="primary">Run report</s-button>
          </s-stack>
        </Form>
      </s-section>
      <ReportSection heading="Outstanding layaway transactions" sales={outstanding} emptyMessage="No outstanding layaway transactions match this search." />
      <ReportSection heading="Completed layaway transactions" sales={completed} emptyMessage="No completed layaway transactions in this range." />
    </s-page>
  );
}

function ReportSection({ heading, sales, emptyMessage }) {
  return (
    <s-section heading={heading}>
      {sales.length === 0 ? <s-paragraph>{emptyMessage}</s-paragraph> : (
        <s-stack direction="block" gap="base">
          {sales.map((sale) => (
            <s-box key={sale.id} padding="base" borderWidth="base" borderRadius="base">
              <s-heading>{sale.orderNumber} - {sale.customerName}</s-heading>
              <s-paragraph>Started {sale.initialDate} | Total {formatMoney(sale.totalCents)} | Down payment {formatMoney(sale.downPaymentCents)} | Allowed installments {sale.allowedInstallments} | Recorded installments {sale.installments.length} | Remaining {formatMoney(sale.remainingCents)}</s-paragraph>
              {sale.orderReference && <s-paragraph>Internal reference: {sale.orderReference}</s-paragraph>}
              {sale.installments.length > 0 && <s-unordered-list>{sale.installments.map((payment) => <s-list-item key={payment.id}>{payment.paidAt}: {formatMoney(payment.amountCents)}{payment.note ? ` - ${payment.note}` : ""}</s-list-item>)}</s-unordered-list>}
            </s-box>
          ))}
        </s-stack>
      )}
    </s-section>
  );
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function balanceFor(sale) {
  return sale.totalCents - sale.downPaymentCents - sale.installments.reduce((total, payment) => total + payment.amountCents, 0);
}

function formatMoney(cents) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

function serializeSale(sale) {
  return {
    ...sale,
    initialDate: sale.initialDate.toISOString().slice(0, 10),
    remainingCents: balanceFor(sale),
    installments: sale.installments.map((payment) => ({ ...payment, paidAt: payment.paidAt.toISOString().slice(0, 10) })),
  };
}

export const headers = (headersArgs) => boundary.headers(headersArgs);