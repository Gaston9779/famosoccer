"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { Spinner } from "./spinner";

export type ScopeTab = { label: string; href: string; active: boolean };

/**
 * Wraps the players scope tabs (Uzbekistan/Italian abroad/France/Altro) and the
 * results below them. Navigation between tabs re-runs a DB query on the server,
 * which can take a moment on a remote database — without this, the tab bar just
 * highlights the new tab while the old results sit there unchanged until the
 * response lands, reading as a broken/unresponsive click.
 */
export function PlayerScopeTabs({ tabs, children }: { tabs: ScopeTab[]; children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>, tab: ScopeTab) => {
    if (tab.active || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setPendingHref(tab.href);
    startTransition(() => router.push(tab.href));
  };

  return (
    <>
      <nav className="players-scope-tabs" aria-label="Player scope">
        {tabs.map((tab) => (
          <a
            key={tab.label}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={tab.active ? "active" : ""}
            onClick={(event) => handleClick(event, tab)}
          >
            {tab.label}
            {isPending && pendingHref === tab.href && <Spinner size="sm" />}
          </a>
        ))}
      </nav>
      <div className={isPending ? "players-scope-content is-pending" : "players-scope-content"} aria-busy={isPending}>
        {children}
        {isPending && <div className="players-scope-pending-overlay"><Spinner size="lg" label="Loading players" /></div>}
      </div>
    </>
  );
}
