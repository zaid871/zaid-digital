import Link from "next/link";
import { notFound } from "next/navigation";
import { getStoreProduct } from "@/lib/digital/storefront";

// The catalog is read from disk at request time (products appear as
// they are generated), so this route is not statically prerenderable.
// (Next 16 "Cache Components" model: `dynamic = "force-dynamic"`
// no longer exists — `instant = false` opts out instead.)
export const instant = false;

/** /store/<category>/<id> — one product's page. */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ category: string; id: string }>;
}) {
  const { category, id } = await params;
  const product = await getStoreProduct(category, decodeURIComponent(id));
  if (!product) notFound();
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-sm text-zinc-500">
        <Link href="/store" className="hover:text-zinc-300">
          Store
        </Link>
        <span> / </span>
        <Link href={`/store/${product.category}`} className="hover:text-zinc-300">
          {product.categoryLabel}
        </Link>
        <span> / </span>
        <span className="text-zinc-300">{product.title}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        {product.previewImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.previewImage}
            alt={product.title}
            className="w-full rounded-xl border border-zinc-800 object-cover"
          />
        ) : (
          <div className="flex h-64 w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900">
            <span className="text-6xl font-bold text-zinc-600">{product.title.charAt(0).toUpperCase()}</span>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-indigo-600/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
              {product.categoryLabel}
            </span>
            {product.badge ? (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{product.badge}</span>
            ) : null}
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{product.type}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{product.title}</h1>
          {product.subtitle ? <p className="text-lg text-zinc-300">{product.subtitle}</p> : null}
          {product.description ? <p className="text-zinc-400">{product.description}</p> : null}
          {product.details.length ? (
            <ul className="list-disc pl-5 text-sm text-zinc-300">
              {product.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
          {product.createdAt ? (
            <p className="text-xs text-zinc-500">
              Added {new Date(product.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          ) : null}

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <p className="font-medium">Checkout jald aa raha hai.</p>
            <p className="mt-1 text-amber-200/80">
              Khareedne ka option (Gumroad ya Razorpay) abhi setup nahi hua hai —
              jaise hi selling layer live hoga, yahin se khareed sakenge. Tab tak
              price bhi yahan show nahi hogi.
            </p>
          </div>
        </div>
      </div>

      {product.includedFiles.length ? (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="font-semibold">What&apos;s included</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-zinc-400">
            {product.includedFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
            {product.hasZip ? <li>Full product ZIP</li> : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
