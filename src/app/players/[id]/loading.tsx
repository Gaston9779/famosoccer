export default function Loading() {
  return (
    <div className="detail-skeleton" aria-label="Loading player" role="status">
      <div className="skeleton sk-head" />
      <div className="sk-kpis">
        {Array.from({ length: 5 }, (_, i) => (
          <div className="skeleton sk-kpi" key={i} />
        ))}
      </div>
      <div className="skeleton sk-panel" />
      <span className="sr-only">Loading player</span>
    </div>
  );
}
