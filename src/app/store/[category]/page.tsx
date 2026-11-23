import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listStoreProducts, knownCategorySlugs, categoryMeta } from "@/lib/digital/storefront";
import StoreGrid from "../store-grid";

// The catalog is read from disk at request time (products appear as
// they are generated), so this route is not statically prerenderable.
// (Next 16 "Cache Components" model: `dynamic = "force-dynamic"`
// no longer exists — `instant = false` opts out instead.)
export const instant = false;

type Props = { params: Promise<{ category: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const meta = categoryMeta(category);
  if (meta) {
    return {
      title: `${meta.title} — Zaid Digital Store`,
      description: meta.description,
    };
  }
  // Other categories: fall back to the catalog label (dynamic read).
  const catalog = await listStoreProducts();
  const cat = catalog.categories.find((c) => c.slug === category);
  if (!cat) return { title: "Store — Digital Products" };
  return {
    title: `${cat.label} — Zaid Digital Store`,
    description: `${cat.label} — digital products from Zaid Digital.`,
  };
}

/** /store/<category> — one category's products.
 * The four main categories (ebooks, templates, spreadsheets, pod)
 * render even with zero products, so their links from social profiles
 * never 404; unknown slugs still 404. */
export default async function CategoryPage({ params }: Props) {
  const { category } = await params;
  const catalog = await listStoreProducts();
  const cat = catalog.categories.find((c) => c.slug === category);
  const meta = categoryMeta(category);
  if (!cat && !meta && !knownCategorySlugs().includes(category)) notFound();
  const label = cat?.label ?? meta?.label ?? category;
  const products = catalog.products.filter((p) => p.category === category);
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-sm text-zinc-500">
        <Link href="/store" className="hover:text-zinc-300">
          Store
        </Link>
        <span> / </span>
        <span className="text-zinc-300">{label}</span>
      </nav>
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{label}</h1>
        {meta ? (
          <p className="mt-2 text-zinc-400">{meta.blurb}</p>
        ) : (
          <p className="mt-1 text-zinc-400">
            {products.length} product{products.length === 1 ? "" : "s"}
          </p>
        )}
        {meta ? (
          <p className="mt-1 text-sm text-zinc-500">
            {products.length} product{products.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </header>
      {products.length ? (
        <StoreGrid products={products} />
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
          <p className="font-medium text-zinc-200">Abhi is category mein koi product nahi hai.</p>
          <p className="mt-1 text-sm">
            Naye products banate hi yahan apne aap listing ho jayegi — dekhte
            rahiye, jald aa raha hai.
          </p>
        </div>
      )}
    </div>
  );
}
