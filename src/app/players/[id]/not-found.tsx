import Link from "next/link";

export default function PlayerNotFound() {
  return (
    <div className="app-error" role="alert">
      <p className="eyebrow">Player</p>
      <h1>Player not found</h1>
      <p>
        This player isn&apos;t in the database. It may have been removed, or the link is out of date.
      </p>
      <div className="app-error-actions">
        <Link href="/players" className="app-error-home">
          Back to players
        </Link>
      </div>
    </div>
  );
}
