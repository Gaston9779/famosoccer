"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function ImportForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <form
      className="my-8 rounded-xl border border-slate-700 bg-slate-900 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage("");
        try {
          const response = await fetch("/api/players/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error?.message ?? "Import failed");
          setMessage(`Imported / updated ${result.player.name}`);
          router.refresh();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Import failed");
        } finally {
          setLoading(false);
        }
      }}
    >
      <label htmlFor="url" className="mb-3 block font-semibold">
        Import player
      </label>
      <div className="flex flex-wrap gap-3">
        <input
          id="url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.transfermarkt.com/player/profil/spieler/123"
          className="min-w-64 flex-1 rounded border border-slate-600 px-3 py-3"
        />
        <button
          disabled={loading}
          className="rounded bg-emerald-400 px-6 py-3 font-semibold text-slate-950 disabled:opacity-50"
        >
          {loading ? "Importing…" : "Import player"}
        </button>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        Profile and seasonal statistics. Existing players are updated by
        Transfermarkt ID.
      </p>
      <p role="status" className="mt-2 text-sm">
        {message}
      </p>
    </form>
  );
}
