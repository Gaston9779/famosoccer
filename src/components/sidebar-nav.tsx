"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const items = [
  ["Dashboard", "/", "⌂"],
  ["Players", "/players", "♙"],
  ["Clubs", "/clubs", "▥"],
  ["Opportunities", "/opportunities", "♢"],
  ["Matches", "/opportunities?tab=matches", "⌘"],
  ["Market Radar", "/market-radar", "◌"],
] as const;

// 1. Componente interno con la logica dei parametri di ricerca
function SidebarNavContent() {
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
          <Link key={label} href={href} className={matches ? "active" : ""}>
            <span aria-hidden="true">{icon}</span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

// 2. Componente principale esportato avvolto da Suspense
export function SidebarNav() {
  return (
    <Suspense fallback={<nav className="sidebar-nav" />}>
      <SidebarNavContent />
    </Suspense>
  );
}