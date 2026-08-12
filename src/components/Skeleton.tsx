export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-2xl border border-border-subtle ${className}`} />;
}
