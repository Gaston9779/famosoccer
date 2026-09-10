"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "./favorite-toggle.css";

type Props = { playerId: string; initial?: boolean | null; compact?: boolean };

export function FavoriteToggle(props: Props) {
  // A different player must never reuse optimistic state or an in-flight request.
  return <PlayerFavoriteToggle key={props.playerId} {...props} />;
}

function PlayerFavoriteToggle({ playerId, initial, compact = false }: Props) {
  const persisted = initial === true;
  const [state, setState] = useState({ persisted, favorite: persisted });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const router = useRouter();
  if (state.persisted !== persisted) setState({ persisted, favorite: persisted });
  const favorite = state.persisted === persisted ? state.favorite : persisted;
  const toggle = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (pending.current) return;
    pending.current = true;
    const next = !favorite;
    setState({ persisted, favorite: next });
    setSaving(true);
    setError(false);
    try {
      const response = await fetch(`/api/players/${playerId}/favorite`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ isFavorite: next }),
      });
      if (!response.ok) throw new Error("Favorite update failed");
      const saved = await response.json();
      if (saved.id !== playerId || typeof saved.isFavorite !== "boolean") throw new Error("Invalid favorite response");
      setState({ persisted, favorite: saved.isFavorite });
      router.refresh();
    } catch {
      setState({ persisted, favorite });
      setError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return <button type="button" onClick={toggle} disabled={saving}
    className={`favorite-toggle ${compact ? "favorite-toggle-compact" : ""}`}
    title={error ? "Could not save favorite. Click to retry." : favorite ? "Remove from favorites" : "Add to favorites"}
    aria-label={favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={favorite}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91Z" /></svg>
    {!compact && <span>{favorite ? "Favorite" : "Add to favorites"}</span>}
    {error && <span role="alert" className="sr-only">Could not save favorite. Please retry.</span>}
  </button>;
}
