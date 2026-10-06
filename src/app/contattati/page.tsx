import { db } from "@/lib/db";
import { ContactedPlayersManager } from "@/components/contacted-players-manager";
import "./contattati.css";

export const dynamic = "force-dynamic";

export default async function ContattatiPage() {
  const entries = await db.contactedPlayer.findMany({
    include: { player: { select: { id: true, name: true, portraitUrl: true, mainPosition: true, club: { select: { name: true } } } }, statusEvents: { orderBy: { changedAt: "desc" } } },
    orderBy: [{ lastStatusAt: "desc" }, { addedAt: "desc" }],
  });
  return <div className="contacted-page">
    <header className="contacted-page-header"><p className="eyebrow">Commercial intelligence</p><h1>Contattati</h1><p>Registro operativo dei giocatori di interesse: stato, note e cronologia dei contatti.</p></header>
    <ContactedPlayersManager initialEntries={entries.map((entry) => ({ ...entry, addedAt: entry.addedAt.toISOString(), firstContactedAt: entry.firstContactedAt?.toISOString() ?? null, lastStatusAt: entry.lastStatusAt.toISOString(), statusEvents: entry.statusEvents.map((event) => ({ ...event, changedAt: event.changedAt.toISOString() })), player: { ...entry.player, role: entry.player.mainPosition } }))} />
  </div>;
}
