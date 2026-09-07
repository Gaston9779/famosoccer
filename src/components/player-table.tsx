"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ClubLogo, PlayerAvatar } from "@/components/media";
import { formatRepresentation } from "@/lib/presentation";

type PlayerRow = {
  id: string;
  name: string;
  portraitUrl: string | null;
  club: { id: string; name: string; tmClubId: string } | null;
  role: string;
  age: number | null;
  nationality: string | null;
  contract: string | null;
  representation: string;
  agency: string | null;
  marketValue: number | null;
  playingTime: number | null;
  opportunity: number | null;
  confidence: number | null;
};

type SortKey = "opportunity" | "marketValue" | "age" | "contract" | "name";
type Filters = {
  search: string;
  role: string;
  club: string;
  nationality: string;
  contract: string;
  representation: string;
  minAge: string;
  maxAge: string;
  minValue: string;
  maxValue: string;
  minScore: string;
  maxScore: string;
};

const emptyFilters: Filters = { search: "", role: "", club: "", nationality: "", contract: "", representation: "", minAge: "", maxAge: "", minValue: "", maxValue: "", minScore: "", maxScore: "" };
const money = (value: number) => {
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (value >= 1_000) return `€${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `€${value}`;
};
const date = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return `${String(day).padStart(2, "0")} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${year}`;
};

const labelRole = (role: string) => role === "UNKNOWN" ? "Unknown role" : role;
const nationalityCodes: Record<string, [string, string]> = {
  Uzbekistan: ["🇺🇿", "UZB"], Russia: ["🇷🇺", "RUS"], Kazakhstan: ["🇰🇿", "KAZ"], Kyrgyzstan: ["🇰🇬", "KGZ"], Tajikistan: ["🇹🇯", "TJK"],
  Turkmenistan: ["🇹🇲", "TKM"], Belarus: ["🇧🇾", "BLR"], Ukraine: ["🇺🇦", "UKR"], Azerbaijan: ["🇦🇿", "AZE"], Georgia: ["🇬🇪", "GEO"],
  Montenegro: ["🇲🇪", "MNE"], Serbia: ["🇷🇸", "SRB"], Italy: ["🇮🇹", "ITA"], Brazil: ["🇧🇷", "BRA"], Nigeria: ["🇳🇬", "NGA"],
  Ghana: ["🇬🇭", "GHA"], Cameroon: ["🇨🇲", "CMR"], Senegal: ["🇸🇳", "SEN"], Mali: ["🇲🇱", "MLI"], "Côte d’Ivoire": ["🇨🇮", "CIV"], "Cote d'Ivoire": ["🇨🇮", "CIV"],
};
const nationalityDisplay = (value: string | null) => {
  const primary = value?.split(",")[0]?.trim();
  if (!primary) return { flag: "", code: "Nationality unknown" };
  const known = nationalityCodes[primary];
  return known ? { flag: known[0], code: known[1] } : { flag: "", code: primary.slice(0, 3).toUpperCase() };
};
const scoreTone = (score: number | null) => score == null ? "none" : score >= 70 ? "high" : score >= 40 ? "medium" : "low";

function PlayerCard({ row }: { row: PlayerRow }) {
  const representation = formatRepresentation(row.representation as Parameters<typeof formatRepresentation>[0], row.agency);
  return (
    <article className="player-card">
      <Link className="player-card-player-link" href={`/players/${row.id}`} aria-label={`View ${row.name}`} />
      <div className="player-card-top">
        <PlayerAvatar name={row.name} portraitUrl={row.portraitUrl} />
        <span className={`player-card-score player-card-score-${scoreTone(row.opportunity)}`}>{row.opportunity == null ? "—" : row.opportunity.toFixed(1)}</span>
      </div>
      <div className="player-card-identity">
        <strong title={row.name}>{row.name}</strong>
        <span>{row.age == null ? "Age unavailable" : `${row.age} years old`}</span>
        <em>{labelRole(row.role)}</em>
      </div>
      <div className="player-card-club-row">
        {row.club ? <Link href={`/clubs/${row.club.id}`} className="player-card-club"><ClubLogo name={row.club.name} tmClubId={row.club.tmClubId} /><b title={row.club.name}>{row.club.name}</b></Link> : <span className="player-card-club muted">No current club</span>}
        <small title={row.nationality ?? undefined}>{nationalityDisplay(row.nationality).flag} {nationalityDisplay(row.nationality).code}</small>
      </div>
      <div className="player-card-meta">
        <div><span>Contract</span><strong>{row.contract ? date(row.contract) : "—"}</strong></div>
        <div><span>Value</span><strong>{row.marketValue == null ? "—" : money(row.marketValue)}</strong></div>
        <div><span>Rep.</span><strong title={representation}>{representation}</strong></div>
      </div>
    </article>
  );
}

export function PlayerTable({ rows }: { rows: PlayerRow[] }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<SortKey>("opportunity");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [view, setView] = useState<"grid" | "list">("grid");
  const roles = useMemo(() => [...new Set(rows.map((row) => labelRole(row.role)))].sort(), [rows]);
  const clubs = useMemo(() => [...new Map(rows.flatMap((row) => row.club ? [[row.club.id, row.club.name] as const] : [])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const nationalities = useMemo(() => [...new Set(rows.map((row) => nationalityDisplay(row.nationality).code).filter((value) => value !== "Nationality unknown"))].sort(), [rows]);
  const update = <Key extends keyof Filters>(key: Key, value: Filters[Key]) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const visible = useMemo(() => rows.filter((row) => {
    const contractStatus = row.contract ? new Date(`${row.contract}T00:00:00Z`) : null;
    const now = new Date();
    const thisYear = now.getUTCFullYear();
    const contains = (value: string | null | undefined, target: string) => !target || String(value ?? "").toLowerCase().includes(target.toLowerCase());
    const inRange = (value: number | null, min: string, max: string) => value != null && (!min || value >= Number(min)) && (!max || value <= Number(max));
    return contains(row.name, filters.search)
      && (!filters.role || labelRole(row.role) === filters.role)
      && (!filters.club || row.club?.id === filters.club)
      && (!filters.nationality || nationalityDisplay(row.nationality).code === filters.nationality)
      && (!filters.representation || row.representation === filters.representation)
      && (!filters.contract || (filters.contract === "known" ? !!contractStatus : filters.contract === "expiring" ? !!contractStatus && contractStatus.getUTCFullYear() <= thisYear + 1 : !contractStatus))
      && inRange(row.age, filters.minAge, filters.maxAge)
      && inRange(row.marketValue, filters.minValue, filters.maxValue)
      && inRange(row.opportunity, filters.minScore, filters.maxScore);
  }).sort((a, b) => {
    const score = (value: number | null) => value ?? -1;
    const dateValue = (value: string | null) => value ? new Date(`${value}T00:00:00Z`).getTime() : Number.POSITIVE_INFINITY;
    const difference = sort === "name" ? a.name.localeCompare(b.name) : sort === "age" ? score(a.age) - score(b.age) : sort === "marketValue" ? score(b.marketValue) - score(a.marketValue) : sort === "contract" ? dateValue(a.contract) - dateValue(b.contract) : score(b.opportunity) - score(a.opportunity);
    return difference || a.name.localeCompare(b.name);
  }), [rows, filters, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pageRows = visible.slice((currentPage - 1) * perPage, currentPage * perPage);
  const pagination = Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
    if (totalPages <= 5) return index + 1;
    if (currentPage <= 3) return index + 1;
    if (currentPage >= totalPages - 2) return totalPages - 4 + index;
    return currentPage - 2 + index;
  });
  const reset = () => { setFilters(emptyFilters); setSort("opportunity"); setPage(1); };

  return <div className="players-browser">
    <section className="players-filter-panel" aria-label="Filter players">
      <div className="players-filter-row players-filter-main">
        <label className="players-search"><span aria-hidden="true">⌕</span><input value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder="Search players…" aria-label="Search players" /></label>
        <select value={filters.role} onChange={(event) => update("role", event.target.value)} aria-label="Role"><option value="">All roles</option>{roles.map((role) => <option key={role}>{role}</option>)}</select>
        <select value={filters.club} onChange={(event) => update("club", event.target.value)} aria-label="Club"><option value="">All clubs</option>{clubs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select value={filters.nationality} onChange={(event) => update("nationality", event.target.value)} aria-label="Nationality"><option value="">All nationalities</option>{nationalities.map((nationality) => <option key={nationality}>{nationality}</option>)}</select>
        <select value={filters.contract} onChange={(event) => update("contract", event.target.value)} aria-label="Contract status"><option value="">All contract status</option><option value="known">Known contract</option><option value="expiring">Expiring within 12 months</option><option value="missing">Contract unknown</option></select>
        <select value={filters.representation} onChange={(event) => update("representation", event.target.value)} aria-label="Representation"><option value="">All representation</option><option value="NO_AGENT">No agent</option><option value="FAMILY">Family</option><option value="AGENCY">Represented</option><option value="NOT_LISTED">Not listed</option><option value="UNKNOWN">Unknown</option></select>
      </div>
      <div className="players-filter-row players-filter-ranges">
        <label>Age range <span><input type="number" min="0" value={filters.minAge} onChange={(event) => update("minAge", event.target.value)} aria-label="Minimum age" placeholder="Min" /><i /> <input type="number" min="0" value={filters.maxAge} onChange={(event) => update("maxAge", event.target.value)} aria-label="Maximum age" placeholder="Max" /></span></label>
        <label>Market value <span><input type="number" min="0" value={filters.minValue} onChange={(event) => update("minValue", event.target.value)} aria-label="Minimum market value" placeholder="Min €" /><i /> <input type="number" min="0" value={filters.maxValue} onChange={(event) => update("maxValue", event.target.value)} aria-label="Maximum market value" placeholder="Max €" /></span></label>
        <label>Opportunity score <span><input type="number" min="0" max="100" value={filters.minScore} onChange={(event) => update("minScore", event.target.value)} aria-label="Minimum opportunity score" placeholder="Min" /><i /> <input type="number" min="0" max="100" value={filters.maxScore} onChange={(event) => update("maxScore", event.target.value)} aria-label="Maximum opportunity score" placeholder="Max" /></span></label>
        <button type="button" className="players-reset" onClick={reset}>↻ Reset</button>
      </div>
    </section>
    <section className="players-results-header">
      <h2>{visible.length} players</h2>
      <div><label>Sort by <select value={sort} onChange={(event) => { setSort(event.target.value as SortKey); setPage(1); }}><option value="opportunity">Opportunity score</option><option value="marketValue">Market value</option><option value="age">Age</option><option value="contract">Contract expiry</option><option value="name">Name</option></select></label><div className="players-view-switch" role="group" aria-label="Player result view"><button type="button" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>▦ Grid</button><button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>☷ List</button></div></div>
    </section>
    <section className={`players-grid players-grid-${view}`} aria-label="Player results">{pageRows.map((row) => <PlayerCard key={row.id} row={row} />)}</section>
    {!pageRows.length && <p className="empty">No players match these filters.</p>}
    <nav className="players-pagination" aria-label="Player pages">
      <p>{visible.length ? `Showing ${(currentPage - 1) * perPage + 1}–${Math.min(currentPage * perPage, visible.length)} of ${visible.length} players` : "Showing 0 players"}</p>
      <div><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">‹</button>{pagination[0] > 1 && <><button type="button" onClick={() => setPage(1)}>1</button><span>…</span></>}{pagination.map((number) => <button key={number} type="button" className={number === currentPage ? "active" : ""} onClick={() => setPage(number)}>{number}</button>)}{pagination.at(-1)! < totalPages && <><span>…</span><button type="button" onClick={() => setPage(totalPages)}>{totalPages}</button></>}<button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} aria-label="Next page">›</button></div>
      <label>Players per page <select value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); setPage(1); }}><option value="10">10</option><option value="20">20</option><option value="40">40</option></select></label>
    </nav>
  </div>;
}
