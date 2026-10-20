"use client";

import { useState } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { useGetMyInvoices } from "@/lib/react-query/hooks/invoices/useGetMyInvoices";
import { Invoice, InvoiceDownload, InvoiceStatus } from "@/lib/types/invoice";
import { FileText, Download, Loader2 } from "lucide-react";
import { apiClient, sanitizeDownloadFilename } from "@/lib/apiClient";
import { formatDate, formatNaira } from "@/lib/utils";

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  PAID: "bg-green-50 text-green-700",
  PENDING: "bg-amber-50 text-amber-700",
  CANCELLED: "bg-red-50 text-red-600",
};

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNaira = formatNaira(invoice.amountKobo);
  const dateLabel = invoice.paidAt
    ? `Paid ${formatDate(invoice.paidAt)}`
    : `Created ${formatDate(invoice.createdAt)}`;

  async function handleDownload() {
    // A second click while a download is in flight must not start another request.
    if (downloading) return;
    setDownloading(true);
    setError(null);

    try {
      // `apiClient.download` sends the bearer token, so an expired session is
      // reported as such instead of silently returning a login page.
      const { blob, filename } = await apiClient.download(
        `/invoices/${invoice.id}/download`
      );

      const download: InvoiceDownload = {
        blob,
        // Never trust the server's name as a path segment.
        filename: sanitizeDownloadFilename(
          filename,
          `invoice-${invoice.invoiceNumber}.pdf`
        ),
      };

      const url = URL.createObjectURL(download.blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = download.filename;
        anchor.rel = "noopener";
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Could not download this invoice. Please try again."
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-gray-400" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">
              {invoice.invoiceNumber}
            </p>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[invoice.status]}`}
            >
              {invoice.status}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{dateLabel}</p>
          {invoice.lineItems?.[0]?.description && (
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">
              {invoice.lineItems[0].description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <p className="text-base font-bold text-gray-900">{amountNaira}</p>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          aria-busy={downloading}
          aria-label={`Download invoice ${invoice.invoiceNumber} as PDF`}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-xs font-medium text-gray-600 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          {downloading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Downloading…
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              PDF
            </>
          )}
        </button>
      </div>

      {error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export default function InvoicesPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch, isFetching } = useGetMyInvoices(
    page,
    10
  );

  const invoices = data?.data ?? [];
  const meta = data?.meta;

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <p className="text-gray-500 mt-1 text-sm">
          View and download your payment invoices.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-100 h-20 animate-pulse"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="text-center py-16 text-gray-500">
          <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Failed to load invoices</p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isFetching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Retrying…
              </>
            ) : (
              "Retry"
            )}
          </button>
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No invoices yet</p>
          <p className="text-sm mt-1">
            Invoices are generated automatically after successful payments.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
            ))}
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between mt-8">
              <p className="text-sm text-gray-500">
                {meta.total} invoice{meta.total !== 1 ? "s" : ""} total
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </DashboardLayout>
  );
}
