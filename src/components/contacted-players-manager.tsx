"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PlayerAvatar } from "@/components/media";

type Status = "DA_CONTATTARE" | "CONTATTATO" | "RIFIUTATO" | "STALLO";
type PlayerResult = { id: string; name: string; portraitUrl: string | null; role: string | null; club: { name: string } | null };
type Entry = { id: string; status: Status; note: string | null; addedAt: string; firstContactedAt: string | null; lastStatusAt: string; statusEvents: { id: string; status: Status; changedAt: string }[]; player: PlayerResult };
const statusMeta: Record<Status, { label: string; icon: string; detail: string }> = {
  DA_CONTATTARE: { label: "Da contattare", icon: "◌", detail: "Profilo monitorato: il contatto non è ancora partito." },
  CONTATTATO: { label: "Contattato", icon: "✓", detail: "Primo contatto effettuato o conversazione attiva." },
  RIFIUTATO: { label: "Rifiutato", icon: "×", detail: "Il giocatore o il suo entourage non è interessato." },
  STALLO: { label: "Stallo", icon: "Ⅱ", detail: "Trattativa sospesa: serve un follow-up o una decisione." },
};
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function ContactedPlayersManager({ initialEntries }: { initialEntries: Entry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tracked = useMemo(() => new Set(entries.map((entry) => entry.player.id)), [entries]);

  async function search(value: string) {
    setQuery(value);
    if (value.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const response = await fetch(`/api/players/search?q=${encodeURIComponent(value)}`);
      setResults(response.ok ? await response.json() : []);
    } finally { setSearching(false); }
  }
  async function add(player: PlayerResult) {
    setError(null);
    const response = await fetch("/api/contacted-players", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: player.id }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error?.message ?? "Impossibile aggiungere il giocatore."); return; }
    if (!payload.alreadyTracked) setEntries((current) => [{ ...payload.item, statusEvents: payload.item.statusEvents ?? [], player }, ...current]);
    setQuery(""); setResults([]);
  }
  async function update(entry: Entry, changes: Partial<Pick<Entry, "status" | "note">>) {
    setError(null);
    const response = await fetch(`/api/contacted-players/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error?.message ?? "Impossibile salvare la modifica."); return; }
    setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, ...payload.item, statusEvents: changes.status && changes.status !== item.status ? [{ id: `local-${Date.now()}`, status: changes.status, changedAt: payload.item.lastStatusAt }, ...item.statusEvents] : item.statusEvents } : item));
  }

  return <div className="contacted-manager">
    <section className="contacted-add panel">
      <div><p className="eyebrow">Nuovo monitoraggio</p><h2>Aggiungi un giocatore</h2><p>Cerca nel database e premi <b>+</b>. L&apos;inserimento e ogni cambio di stato vengono datati.</p></div>
      <label className="contacted-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => void search(event.target.value)} placeholder="Cerca un giocatore…" aria-label="Cerca un giocatore da aggiungere" /></label>
      {(searching || results.length > 0) && <div className="contacted-results">{searching ? <p>Ricerca…</p> : results.map((player) => <div key={player.id}><PlayerAvatar name={player.name} portraitUrl={player.portraitUrl} /><span><b>{player.name}</b><small>{player.role ?? "Ruolo non disponibile"}{player.club ? ` · ${player.club.name}` : ""}</small></span><button type="button" title="Aggiungi a Contattati" aria-label={`Aggiungi ${player.name} a Contattati`} disabled={tracked.has(player.id)} onClick={() => void add(player)}>{tracked.has(player.id) ? "✓" : "+"}</button></div>)}</div>}
      {error && <p className="contacted-error" role="alert">{error}</p>}
    </section>
    <section className="contacted-status-legend" aria-label="Legenda stati">{(Object.keys(statusMeta) as Status[]).map((key) => <span key={key} className={`contacted-status contacted-status-${key.toLowerCase()}`} title={statusMeta[key].detail}><i>{statusMeta[key].icon}</i>{statusMeta[key].label}</span>)}</section>
    <section className="contacted-list">{entries.length ? entries.map((entry) => <article className="contacted-entry" key={entry.id}>
      <Link href={`/players/${entry.player.id}`} className="contacted-player"><PlayerAvatar name={entry.player.name} portraitUrl={entry.player.portraitUrl} size="lg" /><span><strong>{entry.player.name}</strong><small>{entry.player.role ?? "Ruolo non disponibile"}{entry.player.club ? ` · ${entry.player.club.name}` : ""}</small></span></Link>
      <label className="contacted-status-select"><span>Stato</span><select value={entry.status} onChange={(event) => void update(entry, { status: event.target.value as Status })}>{(Object.keys(statusMeta) as Status[]).map((key) => <option key={key} value={key}>{statusMeta[key].icon} {statusMeta[key].label}</option>)}</select><small title={statusMeta[entry.status].detail}>{statusMeta[entry.status].detail}</small></label>
      <label className="contacted-note"><span>Nota di contatto</span><textarea defaultValue={entry.note ?? ""} maxLength={10000} placeholder="Esito, prossima azione, contesto…" onBlur={(event) => { const note = event.currentTarget.value.trim() || null; if (note !== entry.note) void update(entry, { note }); }} /></label>
      <div className="contacted-history"><dl className="contacted-dates"><div><dt>Aggiunto</dt><dd>{date(entry.addedAt)}</dd></div><div><dt>Primo contatto</dt><dd>{date(entry.firstContactedAt)}</dd></div><div><dt>Ultimo stato</dt><dd>{date(entry.lastStatusAt)}</dd></div></dl><p title="Cronologia degli stati">{(entry.statusEvents ?? []).slice(0, 3).map((event) => <span key={event.id}>{statusMeta[event.status].icon} {statusMeta[event.status].label} · {date(event.changedAt)}</span>)}</p></div>
    </article>) : <section className="panel contacted-empty"><h2>Nessun giocatore in Contattati</h2><p>Cerca un profilo sopra per iniziare il monitoraggio commerciale.</p></section>}</section>
  </div>;
}
