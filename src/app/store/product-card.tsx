import Link from "next/link";
import type { StorefrontProduct } from "@/lib/digital/storefront";

/** One product card on the store listing pages. */
export default function ProductCard({ product }: { product: StorefrontProduct }) {
  const href = `/store/${product.category}/${encodeURIComponent(product.id)}`;
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition hover:border-indigo-500/60 hover:bg-zinc-900/80"
    >
      {product.previewImage ? (
        // Plain <img>: the preview is served by our own API route.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.previewImage}
          alt={product.title}
          className="h-44 w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-44 w-full items-center justify-center bg-zinc-800">
          <span className="text-4xl font-bold text-zinc-600">{product.title.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-600/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
            {product.categoryLabel}
          </span>
          {product.badge ? (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{product.badge}</span>
          ) : null}
        </div>
        <h3 className="font-semibold leading-snug text-zinc-100 group-hover:text-white">{product.title}</h3>
        {product.subtitle ? <p className="text-sm text-zinc-400 line-clamp-2">{product.subtitle}</p> : null}
        {product.details.length ? (
          <p className="mt-auto text-xs text-zinc-500">{product.details.join(" · ")}</p>
        ) : null}
      </div>
    </Link>
  );
}
