/**
 * The single loading primitive for the application. Use `<Spinner />` for inline
 * section loading and `<RouteLoading />` for a full route-segment fallback.
 */
export function Spinner({
  size = "md",
  label,
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  return (
    <span className={`spinner spinner-${size}`} role="status" aria-live="polite">
      <span className="spinner-ring" aria-hidden="true" />
      <span className={label ? "spinner-label" : "sr-only"}>{label ?? "Loading"}</span>
    </span>
  );
}

/** Centered fallback for `loading.tsx` route segments. */
export function RouteLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="route-loading">
      <Spinner size="lg" label={label} />
    </div>
  );
}
