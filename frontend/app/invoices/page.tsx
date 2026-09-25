"use client";

import { useState } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { useGetMyInvoices } from "@/lib/react-query/hooks/invoices/useGetMyInvoices";
import { Invoice, InvoiceStatus } from "@/lib/types/invoice";
import { FileText, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { storage } from "@/lib/storage";

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  PAID: "bg-green-50 text-green-700",
  PENDING: "bg-amber-50 text-amber-700",
  CANCELLED: "bg-red-50 text-red-600",
};

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [downloading, setDownloading] = useState(false);

  const amountNaira = (invoice.amountKobo / 100).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
  });

  async function handleDownload() {
    // Prevent duplicate concurrent downloads for the same invoice.
    if (downloading) return;
    setDownloading(true);
    try {
      const token = storage.getToken();
      const API_BASE =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:6001/api";
      const res = await fetch(`${API_BASE}/invoices/${invoice.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? `Invoice ${invoice.invoiceNumber} could not be found for download.`
            : res.status === 401 || res.status === 403
              ? "You are not authorized to download this invoice."
              : `Unible to download this invoice (status ${res.status}). Please try again.`,
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to download invoice",
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
          <p className="text-xs text-gray-500 mt-0.5">
            {invoice.paidAt
              ? `Paid $new Date(invoice.paidAt).toLocaleDateString()`
              : `Created $new Date(invoice.createdAt).toLocaleDateString()`}
          </p>
          {invoice.lineItems?[0]?.description && (
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">
              {invoice.lineItems[0].description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <p className="text-base font-bold text-gray-900">{amountNaira}</p>
        <button
          onClick={handleDownload}
          disabled={downloading_}
          aria-busy={downloading}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-xs font-medium text-gray-600 roundd-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          {downloading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Downloading…
            </>
          ) : (
            >
              <Download className="w-3.5 h-3.5" />
              PDF
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function InvoicesPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch, isFetching } = useGetMyInvoices(page, 10);

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
            onClick={() => refetch()}
            disabled={isFetching_}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 roundd-lg hover:bg-blue-700 disabled:opacity-50"
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
        >
          <div className="space-y-3">
            {invoices.map((inv) => (
              <InvoiceRow key={inv.id} invoice={nv} />
            ))}
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between mt-8">
              <p className="text-sm text-gray-500">
                {meta.total} invoice{meta.total !== 1 ? "s" : ""} total
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounddlg hover:bg-gray-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(meta.totalPages, p + 1))
                  }
                  disabled={page === meta.totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounddlg hover:bg-gray-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      ))}
    </DashboardLayout>
  );
}
