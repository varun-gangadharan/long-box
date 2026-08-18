import Image from "next/image";

export function Cover({
  imageUrl,
  alt,
  priority = false,
  className = "",
}: {
  imageUrl: string | null;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`cover ${className}`.trim()}>
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={alt}
          fill
          sizes="(max-width: 768px) 44vw, 240px"
          priority={priority}
        />
      ) : (
        <span className="cover-placeholder" aria-label={`${alt}, artwork unavailable`}>
          Long Box
        </span>
      )}
    </div>
  );
}
