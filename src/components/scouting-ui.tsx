import Link from "next/link";

export const roles = ["GK", "RB", "CB", "LB", "DM", "CM", "AM", "RW", "LW", "ST", "UNKNOWN"];
export const money = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
export const day = (value: Date | null | undefined, fallback = "Unknown") => value ? value.toISOString().slice(0, 10) : fallback;
export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function ScoreBadge({ score }: { score: number | null | undefined }) { const n=score??0; return <span className={`score score-${n>=70?"high":n>=40?"medium":"low"}`}>{score??"—"}</span>; }
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
export function ClubLogo({ name, size="sm" }: {name:string;size?:"sm"|"md"|"lg"}) { return <span aria-label={`${name} initials`} className={`club-logo club-logo-${size}`}>{initials(name)}</span>; }
export function PlayerAvatar({ name, size="sm" }: {name:string;size?:"sm"|"lg"}) { return <span aria-label={`${name} initials`} className={`player-avatar player-avatar-${size}`}>{initials(name)}</span>; }
export function PageHeader({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: React.ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{eyebrow ?? "UZ1 intelligence"}</p><h1>{title}</h1></div>{children}</div>;
}
export function PlayerLink({ id, name }: { id: string; name: string }) { return <Link className="player-link" href={`/players/${id}`}>{name}</Link>; }
