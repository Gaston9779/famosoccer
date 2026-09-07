export function DataCoverage({ items }: { items: { label: string; known: number; total: number }[] }) {
  return <section className="coverage"><div className="section-title"><h2>Data coverage</h2><span>Known fields only</span></div><div className="coverage-grid">{items.map((item) => <div key={item.label}><div><span>{item.label}</span><b>{item.known}/{item.total}</b></div><i><em style={{ width: `${item.total ? item.known / item.total * 100 : 0}%` }} /></i></div>)}</div></section>;
}
