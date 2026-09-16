"use client";

import { Suspense, useState } from "react";
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

const clubCompetitions = [
  ["Uzbekistan", "UZ1"],
  ["Serie A", "IT1"],
  ["Serie B", "IT2"],
  ["Serie C - Girone A", "IT3A"],
] as const;

const playerScopes = [
  ["Uzbekistan", null],
  ["Italian abroad", "ita"],
  ["France", "fra"],
  ["Serie A", "it1"],
  ["Serie B", "it2"],
  ["Serie C", "it3a"],
  ["Altro", "other"],
] as const;

function SidebarNavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  // Menu visibility is a user-controlled UI preference. It must not be tied
  // to the current route: a selected scope remains highlighted when closed.
  const [openMenus, setOpenMenus] = useState({ Players: false, Clubs: false });

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

        if (label === "Players" || label === "Clubs") {
          const isOpen = openMenus[label];
          const optionsId = `sidebar-nav-${label.toLowerCase()}-options`;
          return (
            <div key={label} className={`sidebar-nav-clubs${matches ? " active" : ""}`}>
              <span className="sidebar-nav-accordion-row">
                <Link href={label === "Clubs" ? "/clubs?competition=UZ1" : "/players"} className={matches ? "active" : ""} onClick={onNavigate}>
                  <span aria-hidden="true">{icon}</span>
                  {label}
                  <NavPendingIndicator />
                </Link>
                <button
                  type="button"
                  className="sidebar-nav-accordion-toggle"
                  aria-expanded={isOpen}
                  aria-controls={optionsId}
                  onClick={() => setOpenMenus((menus) => ({ ...menus, [label]: !menus[label] }))}
                >
                  <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                </button>
              </span>
              {isOpen && (
                <div id={optionsId} className="sidebar-nav-club-options" aria-label={label === "Clubs" ? "Club competitions" : "Player scope"}>
                  {(label === "Clubs" ? clubCompetitions : playerScopes).map(([optionLabel, optionValue]) =>
                    label === "Clubs" ? (
                      <Link key={optionValue} href={`/clubs?competition=${optionValue}`} className={pathname === "/clubs" && (search.get("competition") ?? "UZ1") === optionValue ? "active" : ""} onClick={onNavigate}>
                        {optionLabel}
                        <NavPendingIndicator />
                      </Link>
                    ) : (
                      <Link
                        key={optionLabel}
                        href={optionValue ? `/players?scope=${optionValue}` : "/players"}
                        className={pathname === "/players" && (search.get("scope") ?? null) === optionValue ? "active" : ""}
                        onClick={onNavigate}
                      >
                        {optionLabel}
                        <NavPendingIndicator />
                      </Link>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        }

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
