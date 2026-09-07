"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SidebarNav } from "@/components/sidebar-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab" || !drawer.current) return;
      const focusable = drawer.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input,select,[tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    drawer.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Primary navigation">
      <Brand />
      <p className="workspace">PRIVATE WORKSPACE<br />UZBEKISTAN · UZ1</p>
      <SidebarNav />
      <Footer />
    </aside>
    <div className="content">
      <header className="topbar">
        <button className="mobile-menu" type="button" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(true)}>☰</button>
        <form action="/players"><input name="q" aria-label="Search players" placeholder="Search player name…" /></form>
        <span className="status-dot">LIVE DATABASE</span>
      </header>
      <main>{children}</main>
    </div>
    {open && <div className="nav-overlay" onClick={() => setOpen(false)} aria-hidden="true" />}
    <aside ref={drawer} id="mobile-navigation" className={`nav-drawer ${open ? "open" : ""}`} aria-label="Mobile navigation" aria-hidden={!open}>
      <div className="drawer-head"><Brand /><button type="button" aria-label="Close navigation" onClick={() => setOpen(false)}>×</button></div>
      <SidebarNav onNavigate={() => setOpen(false)} />
      <Footer />
    </aside>
  </div>;
}

function Brand() { return <Link href="/" className="brand"><b>◉</b>SOCCER<span>SCOUTING</span></Link>; }
function Footer() { return <div className="sidebar-foot"><i>N</i><p>Commercial Intelligence<br /><span>for Scouting</span></p></div>; }
