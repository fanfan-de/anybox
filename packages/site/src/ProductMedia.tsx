type ProductMediaProps = {
  alt: string
  caption?: string
  variant?: "desktop" | "workspace" | "execution" | "mobile"
}

export function ProductMedia({
  alt,
  caption,
  variant = "desktop",
}: ProductMediaProps) {
  const isMobile = variant === "mobile"

  return (
    <figure className={`product-media is-${variant}`}>
      <div className="product-media-frame">
        <img
          alt={alt}
          decoding="async"
          height={isMobile ? 2550 : 1389}
          loading={variant === "desktop" ? "eager" : "lazy"}
          src={isMobile ? "/anybox-mobile-product-shot.png" : "/product-preview.png"}
          width={isMobile ? 1200 : 2558}
        />
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  )
}
