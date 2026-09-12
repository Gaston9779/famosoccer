"use client";

import { Suspense } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Spinner } from "./spinner";

function NavPendingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner size="sm" /> : null;
}

const items = [
  ["Dashboard", "/", "⌂"],
  ["Players", "/players", "♙"],
  ["Clubs", "/clubs", "▥"],
  ["Opportunities", "/opportunities", "♢"],
  ["Matches", "/opportunities?tab=matches", "⌘"],
  ["Market Radar", "/market-radar", "◌"],
] as const;

function SidebarNavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();

  return (
    <nav className="sidebar-nav">
      {items.map(([label, href, icon]) => {
        const matches =
          label === "Dashboard"
            ? pathname === "/"
            : label === "Matches"
            ? pathname === "/opportunities" && search.get("tab") === "matches"
            : href === "/opportunities"
            ? pathname === "/opportunities" && search.get("tab") !== "matches"
            : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link key={label} href={href} className={matches ? "active" : ""} onClick={onNavigate}>
            <span aria-hidden="true">{icon}</span>
            {label}
            <NavPendingIndicator />
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<nav className="sidebar-nav" />}>
      <SidebarNavContent onNavigate={onNavigate} />
    </Suspense>
  );
}
