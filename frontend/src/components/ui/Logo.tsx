// The ByteSize avocado (made from logo.jpg by scripts/make-icons.mjs)
export function Logo({ className = "size-8" }: { className?: string }) {
  return <img src="/icon-192.png" alt="" aria-hidden="true" className={`rounded-lg ${className}`} />;
}
