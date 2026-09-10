/* eslint-disable react/prop-types */
import { useEffect } from "react";
import { Form, useFetcher, useLoaderData } from "react-router";
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
  const filteredOutstanding = outstanding.filter((sale) => sale.remainingCents > 0);
  const filteredCompleted = completed.filter((sale) => sale.remainingCents === 0);
  return {
    start: url.searchParams.get("start") || "",
    end: url.searchParams.get("end") || "",
    outstandingStart: url.searchParams.get("outstandingStart") || "",
    outstandingEnd: url.searchParams.get("outstandingEnd") || "",
    outstandingOrderNumber,
    outstandingCustomerName,
    view: url.searchParams.get("view") === "table" ? "table" : "details",
    outstanding: filteredOutstanding,
    completed: filteredCompleted,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const reportType = formData.get("reportType");
  if (!['outstanding', 'completed'].includes(reportType)) {
    return { error: "Choose a valid report to download." };
  }

  const startName = reportType === "outstanding" ? "outstandingStart" : "start";
  const endName = reportType === "outstanding" ? "outstandingEnd" : "end";
  const start = parseDate(formData.get(startName));
  const end = parseDate(formData.get(endName), true);
  const orderNumber = String(formData.get("outstandingOrderNumber") || "").trim();
  const customerName = String(formData.get("outstandingCustomerName") || "").trim();
  const sales = await db.layawaySale.findMany({
    where: {
      shop: session.shop,
      ...(reportType === "outstanding" && orderNumber ? { orderNumber: { contains: orderNumber } } : {}),
      ...(reportType === "outstanding" && customerName ? { customerName: { contains: customerName } } : {}),
      ...(start || end ? { initialDate: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    },
    include: { installments: { orderBy: { paidAt: "asc" } } },
    orderBy: { initialDate: "desc" },
  });
  const filteredSales = sales.map(serializeSale).filter((sale) => reportType === "outstanding" ? sale.remainingCents > 0 : sale.remainingCents === 0);
  return {
    csv: toCsv(filteredSales),
    filename: `layaway-${reportType}-${new Date().toISOString().slice(0, 10)}.csv`,
  };
};

export default function Reports() {
  const { start, end, outstandingStart, outstandingEnd, outstandingOrderNumber, outstandingCustomerName, view, outstanding, completed } = useLoaderData();
  const outstandingParams = { outstandingStart, outstandingEnd, outstandingOrderNumber, outstandingCustomerName };
  const completedParams = { start, end };
  return (
    <s-page heading="Layaway reports">
      <s-section heading="Report display">
        <s-stack direction="inline" gap="base">
          <s-button href={reportUrl({ ...outstandingParams, ...completedParams, view: "details" })} {...(view === "details" ? { variant: "primary" } : {})}>Detail view</s-button>
          <s-button href={reportUrl({ ...outstandingParams, ...completedParams, view: "table" })} {...(view === "table" ? { variant: "primary" } : {})}>Table view</s-button>
        </s-stack>
      </s-section>
      <s-section heading="Find outstanding layaway transactions">
        <Form method="get">
          <input type="hidden" name="view" value={view} />
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
          <input type="hidden" name="view" value={view} />
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
      <ReportSection heading="Outstanding layaway transactions" sales={outstanding} emptyMessage="No outstanding layaway transactions match this search." view={view} downloadParams={{ ...outstandingParams, reportType: "outstanding" }} />
      <ReportSection heading="Completed layaway transactions" sales={completed} emptyMessage="No completed layaway transactions in this range." view={view} downloadParams={{ ...completedParams, reportType: "completed" }} />
    </s-page>
  );
}

function ReportSection({ heading, sales, emptyMessage, view, downloadParams }) {
  return (
    <s-section heading={heading}>
      <s-stack direction="block" gap="base">
        <CsvDownloadButton downloadParams={downloadParams} />
        {sales.length === 0 ? <s-paragraph>{emptyMessage}</s-paragraph> : view === "table" ? <ReportTable sales={sales} /> : (
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
      </s-stack>
    </s-section>
  );
}

function CsvDownloadButton({ downloadParams }) {
  const fetcher = useFetcher();

  useEffect(() => {
    if (!fetcher.data?.csv || !fetcher.data?.filename) return;
    const blob = new Blob([fetcher.data.csv], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fetcher.data.filename;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }, [fetcher.data]);

  return (
    <s-stack direction="block" gap="small">
      <s-button type="button" onClick={() => fetcher.submit({ intent: "download-csv", ...downloadParams }, { method: "post" })} {...(fetcher.state !== "idle" ? { loading: true } : {})}>Download CSV</s-button>
      {fetcher.data?.error && <s-banner tone="critical">{fetcher.data.error}</s-banner>}
    </s-stack>
  );
}

function ReportTable({ sales }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Order</th><th>Customer</th><th>Initial date</th><th>Total</th><th>Down payment</th><th>Allowed installments</th><th>Recorded installments</th><th>Remaining</th><th>Internal reference</th>
        </tr>
      </thead>
      <tbody>
        {sales.map((sale) => (
          <tr key={sale.id}>
            <td>{sale.orderNumber}</td><td>{sale.customerName}</td><td>{sale.initialDate}</td><td>{formatMoney(sale.totalCents)}</td><td>{formatMoney(sale.downPaymentCents)}</td><td>{sale.allowedInstallments}</td><td>{sale.installments.length}</td><td>{formatMoney(sale.remainingCents)}</td><td>{sale.orderReference || ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
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

function reportUrl(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) searchParams.set(key, value);
  });
  const query = searchParams.toString();
  return query ? `/app/reports?${query}` : "/app/reports";
}

function toCsv(sales) {
  const highestInstallmentCount = Math.max(0, ...sales.map((sale) => sale.installments.length));
  const installmentHeaders = Array.from({ length: highestInstallmentCount }, (_, index) => [`Installment ${index + 1}`, `Installment ${index + 1} amount`]).flat();
  const headers = ["Shopify order number", "Customer", "Initial date", "Total sale amount", "Down payment", "Allowed installments", "Recorded installments", "Remaining balance", "Internal reference", ...installmentHeaders];
  const rows = sales.map((sale) => {
    const installments = Array.from({ length: highestInstallmentCount }, (_, index) => {
      const payment = sale.installments[index];
      return payment ? [payment.paidAt, (payment.amountCents / 100).toFixed(2)] : ["", ""];
    }).flat();
    return [sale.orderNumber, sale.customerName, sale.initialDate, (sale.totalCents / 100).toFixed(2), (sale.downPaymentCents / 100).toFixed(2), sale.allowedInstallments, sale.installments.length, (sale.remainingCents / 100).toFixed(2), sale.orderReference || "", ...installments];
  });
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}

function escapeCsv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
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