import Link from "next/link";
import { listStoreProducts } from "@/lib/digital/storefront";
import StoreGrid from "./store-grid";

// The catalog is read from disk at request time (products appear as
// they are generated), so this route is not statically prerenderable.
// (Next 16 "Cache Components" model: `dynamic = "force-dynamic"`
// no longer exists — `instant = false` opts out instead.)
export const instant = false;

export const metadata = { title: "Store — Digital Products" };

/** /store — every category + every product, newest first. */
export default async function StorePage() {
  const catalog = await listStoreProducts();
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Digital Products Store</h1>
        <p className="mt-2 text-zinc-400">
          Hamare saare digital products — ebooks, templates, spreadsheets aur
          bhi bahut kuch. Kisi bhi product par click karein, uska poora page khul jayega.
        </p>
      </header>

      {catalog.categories.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Categories</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {catalog.categories.map((c) => (
              <Link
                key={c.slug}
                href={`/store/${c.slug}`}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 transition hover:border-indigo-500/60"
              >
                <span className="block font-medium text-zinc-100">{c.label}</span>
                <span className="text-sm text-zinc-500">
                  {c.count} product{c.count === 1 ? "" : "s"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          {catalog.products.length ? `All products (${catalog.products.length})` : "Products"}
        </h2>
        {catalog.products.length ? (
          <StoreGrid products={catalog.products} featured />
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
            <p className="font-medium text-zinc-200">Abhi store khaali hai.</p>
            <p className="mt-1 text-sm">
              Abhi tak koi digital product generate nahi hua hai. Products
              banate hi yahan apne aap listing ho jayegi — pehla scheduled
              batch Monday 16 Nov, 08:00 IST par chalega.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
