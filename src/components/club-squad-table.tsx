"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PlayerAvatar } from "@/components/media";
import { formatNationality, formatRepresentation, representationTone } from "@/lib/presentation";

export type ClubSquadPlayer = { id: string; name: string; portraitUrl: string | null; nationality: string; age: number | null; role: string; contract: string | null; marketValue: number | null; representation: string; agency: string | null; opportunity: number | null };

const money = (value: number | null) => value == null ? "—" : value >= 1_000_000 ? `€${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m` : value >= 1_000 ? `€${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1).replace(/\.0$/, "")}k` : `€${value}`;
const day = (value: string | null) => { if (!value) return "—"; const [year, month, date] = value.split("-").map(Number); return `${String(date).padStart(2, "0")} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${year}`; };
const scoreTone = (value: number | null) => value == null ? "none" : value >= 70 ? "high" : value >= 40 ? "medium" : "low";

export function ClubSquadTable({ players, clubName }: { players: ClubSquadPlayer[]; clubName: string }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [representation, setRepresentation] = useState("");
  const [minimum, setMinimum] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sort, setSort] = useState<{ key: keyof ClubSquadPlayer; asc: boolean }>({ key: "name", asc: true });
  const roles = useMemo(() => [...new Set(players.map((player) => player.role).filter((value) => value !== "UNKNOWN"))].sort(), [players]);
  const rows = useMemo(() => players.filter((player) => player.name.toLowerCase().includes(search.toLowerCase()) && (!role || player.role === role) && (!representation || player.representation === representation) && (!minimum || (player.opportunity != null && player.opportunity >= Number(minimum)))).sort((a, b) => {
    const av = a[sort.key]; const bv = b[sort.key];
    const normalize = (value: string | number | null) => value == null ? (sort.key === "contract" ? Number.POSITIVE_INFINITY : -1) : value;
    const left = normalize(av); const right = normalize(bv);
    const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "en", { numeric: true });
    return (sort.asc ? result : -result) || a.name.localeCompare(b.name);
  }), [players, search, role, representation, minimum, sort]);
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const activePage = Math.min(page, totalPages);
  const visible = rows.slice((activePage - 1) * perPage, activePage * perPage);
  const change = (fn: () => void) => { fn(); setPage(1); };
  const toggleSort = (key: keyof ClubSquadPlayer) => setSort((current) => ({ key, asc: current.key === key ? !current.asc : true }));
  const header = (key: keyof ClubSquadPlayer, label: string) => <button type="button" onClick={() => toggleSort(key)}>{label}<span>{sort.key === key ? sort.asc ? " ↑" : " ↓" : " ↕"}</span></button>;
  return <section className="club-squad-panel" id="squad">
    <header className="club-squad-header"><div><h2>{clubName} squad</h2><p>Current squad and opportunity analysis by player</p></div><div className="club-squad-filters"><label>⌕ <input value={search} onChange={(event) => change(() => setSearch(event.target.value))} placeholder="Search squad…" aria-label="Search squad" /></label><select value={role} onChange={(event) => change(() => setRole(event.target.value))} aria-label="Filter position"><option value="">All positions</option>{roles.map((value) => <option key={value}>{value}</option>)}</select><select value={representation} onChange={(event) => change(() => setRepresentation(event.target.value))} aria-label="Filter representation"><option value="">All representation</option><option value="NO_AGENT">No agent</option><option value="FAMILY">Family</option><option value="NOT_LISTED">Not listed</option><option value="AGENCY">Represented</option><option value="UNKNOWN">Unknown</option></select><input type="number" min="0" max="100" value={minimum} onChange={(event) => change(() => setMinimum(event.target.value))} placeholder="Min. score" aria-label="Minimum opportunity score" /></div></header>
    <div className="club-squad-table-wrap"><table><thead><tr><th>{header("name", "Player")}</th><th>{header("age", "Age")}</th><th>{header("role", "Position")}</th><th>{header("contract", "Contract")}</th><th>{header("marketValue", "Market value")}</th><th>Representation</th><th>{header("opportunity", "Opportunity")}</th></tr></thead><tbody>{visible.map((player) => { const nationality = formatNationality(player.nationality); return <tr key={player.id}><td><Link href={`/players/${player.id}`} className="club-squad-player"><PlayerAvatar name={player.name} portraitUrl={player.portraitUrl} /><span><strong>{player.name}</strong><small>{nationality.flag} {nationality.code}</small></span></Link></td><td>{player.age ?? "—"}</td><td>{player.role === "UNKNOWN" ? "—" : player.role}</td><td>{day(player.contract)}</td><td>{money(player.marketValue)}</td><td><span className={`club-representation club-representation-${representationTone(player.representation)}`}>{formatRepresentation(player.representation, player.agency)}</span></td><td><span className={`club-score club-score-${scoreTone(player.opportunity)}`}>{player.opportunity == null ? "—" : player.opportunity.toFixed(1)}</span></td></tr>; })}</tbody></table>{!visible.length && <p className="empty">No players match these filters.</p>}</div>
    <footer className="club-squad-pagination"><p>{rows.length ? `Showing ${(activePage - 1) * perPage + 1}–${Math.min(activePage * perPage, rows.length)} of ${rows.length} players` : "Showing 0 players"}</p><div><button type="button" disabled={activePage === 1} onClick={() => setPage(activePage - 1)}>‹</button>{Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 5).map((number) => <button type="button" key={number} className={number === activePage ? "active" : ""} onClick={() => setPage(number)}>{number}</button>)}<button type="button" disabled={activePage === totalPages} onClick={() => setPage(activePage + 1)}>›</button></div><label>Players per page <select value={perPage} onChange={(event) => change(() => setPerPage(Number(event.target.value)))}><option value="10">10</option><option value="20">20</option><option value={players.length}>All</option></select></label></footer>
  </section>;
}
