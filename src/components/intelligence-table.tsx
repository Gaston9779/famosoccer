"use client";
import { useState } from "react";
import Link from "next/link";

export type TableColumn = { key: string; label: string; numeric?: boolean };
export type TableRow = { id: string; values: Record<string, string | number | null>; href?: string; links?: Record<string, string> };
export function IntelligenceTable({ columns, rows, label }: { columns: TableColumn[]; rows: TableRow[]; label: string }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null);
  const visible = rows.filter(row => columns.every(column => {
    const filter = filters[column.key]?.trim() ?? "";
    if (!filter) return true;
    const value = row.values[column.key];
    return column.numeric ? value != null && Number(value) >= Number(filter) : String(value ?? "Unknown").toLowerCase().includes(filter.toLowerCase());
  })).sort((a,b) => {
    if (!sort) return 0;
    const av = a.values[sort.key], bv = b.values[sort.key];
    if (av == null) return bv == null ? a.id.localeCompare(b.id) : 1;
    if (bv == null) return -1;
    const delta = typeof av === "number" && typeof bv === "number" ? av-bv : String(av).localeCompare(String(bv), "en", { numeric: true });
    return (sort.asc ? delta : -delta) || a.id.localeCompare(b.id);
  });
  return <div><div className="mb-3 flex items-center justify-between text-xs text-slate-400"><span>{visible.length} / {rows.length} results</span><button type="button" onClick={() => {setFilters({});setSort(null);}} className="rounded border border-slate-600 px-3 py-2">Reset filters & sort</button></div><div className="table-wrap"><table aria-label={label}><thead><tr>{columns.map(column => <th key={column.key} aria-sort={sort?.key === column.key ? sort.asc ? "ascending" : "descending" : "none"}><button type="button" className="flex w-full items-center gap-2 py-1 text-left" onClick={() => setSort({key: column.key, asc: sort?.key === column.key ? !sort.asc : true})}>{column.label}<span aria-hidden="true">{sort?.key === column.key ? sort.asc ? "↑" : "↓" : "↕"}</span></button></th>)}</tr><tr>{columns.map(column => <th key={column.key}><input aria-label={`${label}: ${column.numeric ? "Minimum" : "Filter"} ${column.label}`} type={column.numeric ? "number" : "search"} step="any" value={filters[column.key] ?? ""} onChange={event => setFilters({...filters,[column.key]:event.target.value})} placeholder={column.numeric ? "Minimum…" : "Filter…"} className="w-full min-w-24 rounded border border-slate-600 bg-slate-900 px-2 py-2 text-xs normal-case tracking-normal"/></th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.id}>{columns.map((column,index) => { const href=row.links?.[column.key] ?? (index === 0 ? row.href : undefined); return <td key={column.key}>{href ? <Link className="player-link" href={href}>{row.values[column.key] ?? "—"}</Link> : row.values[column.key] ?? "—"}</td>})}</tr>)}</tbody></table>{!visible.length && <p className="empty">No results match these filters.</p>}</div></div>;
}
