import Link from "next/link";
import { listStoreProducts } from "@/lib/digital/storefront";
import StoreAdminTable from "./store-admin-table";

// The catalog is read from disk at request time, so this route is not
// statically prerenderable. (Next 16 "Cache Components" model:
// `dynamic = "force-dynamic"` no longer exists — `instant = false`
// opts out instead.)
export const instant = false;

export const metadata = { title: "Store Admin — Digital Products" };

/** /store-admin — the store's backend panel: every product + visibility. */
export default async function StoreAdminPage() {
  const catalog = await listStoreProducts({ includeHidden: true });
  const hiddenCount = catalog.products.filter((p) => p.hidden).length;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Store Admin</h1>
        <p className="mt-2 text-zinc-400">
          Store ke saare products — hide/show karein. Hidden product public
          store se gayab ho jata hai, lekin uski files delete nahi hoti; wapas
          Show karne par phir dikhne lagta hai. Orders aur checkout abhi nahi
          hain — selling layer aane par yahan orders bhi dikhenge.
        </p>
      </header>

      <div className="flex gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
          <span className="block text-2xl font-bold text-zinc-100">{catalog.products.length}</span>
          <span className="text-sm text-zinc-500">Total products</span>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
          <span className="block text-2xl font-bold text-zinc-100">{catalog.products.length - hiddenCount}</span>
          <span className="text-sm text-zinc-500">Visible</span>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
          <span className="block text-2xl font-bold text-zinc-100">{hiddenCount}</span>
          <span className="text-sm text-zinc-500">Hidden</span>
        </div>
      </div>

      <StoreAdminTable products={catalog.products} />

      <p className="text-sm text-zinc-500">
        Public store: <Link href="/store" className="text-indigo-300 hover:underline">/store</Link>
      </p>
    </div>
  );
}
