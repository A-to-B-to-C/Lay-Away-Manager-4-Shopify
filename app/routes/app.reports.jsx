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
  const sales = await db.layawaySale.findMany({
    where: {
      shop: session.shop,
      ...(start || end ? { initialDate: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    },
    include: { installments: { orderBy: { paidAt: "asc" } } },
    orderBy: { initialDate: "desc" },
  });
  const serialized = sales.map(serializeSale);
  return {
    start: url.searchParams.get("start") || "",
    end: url.searchParams.get("end") || "",
    outstanding: serialized.filter((sale) => sale.remainingCents > 0),
    completed: serialized.filter((sale) => sale.remainingCents === 0),
  };
};

export default function Reports() {
  const { start, end, outstanding, completed } = useLoaderData();
  return (
    <s-page heading="Layaway reports">
      <s-section heading="Completed transaction range">
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <s-text-field label="From" name="start" type="date" value={start} />
            <s-text-field label="To" name="end" type="date" value={end} />
            <s-button type="submit" variant="primary">Run report</s-button>
          </s-stack>
        </Form>
      </s-section>
      <ReportSection heading="Outstanding layaway transactions" sales={outstanding} emptyMessage="No outstanding layaway transactions in this range." />
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