"use client";

import { FormEvent, useState } from "react";

type Note = { id: string; content: string; createdAt: string | Date };

export function PlayerNotes({ playerId, initialNotes }: { playerId: string; initialNotes: Note[] }) {
  const [notes, setNotes] = useState(initialNotes);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/players/${playerId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not save the note.");
      setNotes((current) => [payload.note, ...current]);
      setContent("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel player-notes-panel">
    <div className="section-title"><h2>Notes and tags</h2></div>
    <form className="player-note-form" onSubmit={addNote}>
      <label htmlFor={`note-${playerId}`}>Add a private scouting note</label>
      <textarea id={`note-${playerId}`} value={content} onChange={(event) => setContent(event.target.value)} maxLength={10000} placeholder="Add context, follow-up, or a scouting observation…" />
      <div><small>{content.length} / 10,000</small><button type="submit" disabled={!content.trim() || saving}>{saving ? "Saving…" : "Add note"}</button></div>
      {error && <p className="player-note-error" role="alert">{error}</p>}
    </form>
    <div className="player-note-list">
      {notes.length ? notes.map((note) => <article key={note.id}><p>{note.content}</p><small>{new Date(note.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</small></article>) : <p className="muted">No notes yet.</p>}
    </div>
  </section>;
}
