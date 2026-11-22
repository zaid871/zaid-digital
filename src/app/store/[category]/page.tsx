import Link from "next/link";
import { notFound } from "next/navigation";
import { listStoreProducts } from "@/lib/digital/storefront";
import StoreGrid from "../store-grid";

// The catalog is read from disk at request time (products appear as
// they are generated), so this route is not statically prerenderable.
// (Next 16 "Cache Components" model: `dynamic = "force-dynamic"`
// no longer exists — `instant = false` opts out instead.)
export const instant = false;

/** /store/<category> — one category's products. */
export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const catalog = await listStoreProducts();
  const cat = catalog.categories.find((c) => c.slug === category);
  if (!cat) notFound();
  const products = catalog.products.filter((p) => p.category === category);
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-sm text-zinc-500">
        <Link href="/store" className="hover:text-zinc-300">
          Store
        </Link>
        <span> / </span>
        <span className="text-zinc-300">{cat.label}</span>
      </nav>
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{cat.label}</h1>
        <p className="mt-1 text-zinc-400">
          {products.length} product{products.length === 1 ? "" : "s"}
        </p>
      </header>
      <StoreGrid products={products} />
    </div>
  );
}
