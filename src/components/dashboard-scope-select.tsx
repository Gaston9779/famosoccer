"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { Spinner } from "./spinner";

const OPTIONS = [
  { value: "all", label: "All players" },
  { value: "uzbekistan", label: "Uzbekistan" },
  { value: "ita", label: "Italian abroad" },
  { value: "fra", label: "France" },
  { value: "other", label: "Altro" },
] as const;

/**
 * Drives the dashboard's scope filter via a native select instead of tabs (the
 * dashboard has 5 scopes to the players page's 4, and reads as a single
 * "viewing as" setting rather than a set of sibling sections). Same
 * pending/dimming treatment as the players scope tabs, since this triggers the
 * same kind of full-page server re-fetch.
 */
export function DashboardScopeSelect({ value, children }: { value: string; children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    const href = next === "all" ? "/" : `/?scope=${next}`;
    startTransition(() => router.push(href));
  };

  return (
    <>
      <label className="dashboard-scope-select">
        <span>Viewing</span>
        <select value={value} onChange={handleChange} aria-label="Dashboard player scope" disabled={isPending}>
          {OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {isPending && <Spinner size="sm" />}
      </label>
      <div className={isPending ? "dashboard-scope-content is-pending" : "dashboard-scope-content"} aria-busy={isPending}>
        {children}
        {isPending && <div className="dashboard-scope-pending-overlay"><Spinner size="lg" label="Loading dashboard" /></div>}
      </div>
    </>
  );
}
