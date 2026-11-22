"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StorefrontProduct } from "@/lib/digital/storefront";

/** Admin product table: visibility toggle per product. */
export default function StoreAdminTable({ products }: { products: StorefrontProduct[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(p: StorefrontProduct) {
    setBusy(p.id);
    setError(null);
    try {
      const res = await fetch("/api/v1/digital/store/visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, hidden: !p.hidden }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || !data.ok) throw new Error(data.error?.message ?? `Request failed (${res.status}).`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!products.length) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
        Abhi koi product nahi hai — products generate hote hi yahan dikhenge.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p> : null}
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">Category</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Created</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-zinc-800">
                <td className="px-4 py-3">
                  <span className="block font-medium text-zinc-100">{p.title}</span>
                  <span className="text-xs text-zinc-500">{p.id}</span>
                </td>
                <td className="hidden px-4 py-3 text-zinc-400 sm:table-cell">{p.categoryLabel}</td>
                <td className="hidden px-4 py-3 text-zinc-400 md:table-cell">
                  {p.createdAt ? p.createdAt.slice(0, 10) : "—"}
                </td>
                <td className="px-4 py-3">
                  {p.hidden ? (
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">Hidden</span>
                  ) : (
                    <span className="rounded-full bg-emerald-600/20 px-2 py-0.5 text-xs text-emerald-300">Visible</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => toggle(p)}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-indigo-500/60 disabled:opacity-50"
                  >
                    {busy === p.id ? "Saving…" : p.hidden ? "Show" : "Hide"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
