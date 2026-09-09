"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
        <GlobalPlayerSearch />
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
type Suggestion={id:string;name:string;role:string;club:{name:string}|null};
function GlobalPlayerSearch(){const router=useRouter();const root=useRef<HTMLFormElement>(null);const[q,setQ]=useState("");const[items,setItems]=useState<Suggestion[]>([]);const[loading,setLoading]=useState(false);const[active,setActive]=useState(-1);const[open,setOpen]=useState(false);useEffect(()=>{const close=(e:MouseEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[]);useEffect(()=>{if(q.trim().length<2||!open){setItems([]);return}const controller=new AbortController();const id=setTimeout(async()=>{setLoading(true);try{const r=await fetch(`/api/players/search?q=${encodeURIComponent(q)}`,{signal:controller.signal});if(!controller.signal.aborted)setItems(r.ok?await r.json():[]);setActive(-1)}catch{}finally{if(!controller.signal.aborted)setLoading(false)}},200);return()=>{clearTimeout(id);controller.abort()}},[q,open]);const close=()=>{setOpen(false);setItems([]);setActive(-1)};const go=(path:string)=>{close();router.push(path)};const submit=(value=q)=>{if(value.trim())go(`/players?search=${encodeURIComponent(value.trim())}`)};return <form ref={root} className="global-search" onSubmit={e=>{e.preventDefault();const p=items[active];p?go(`/players/${p.id}`):submit();}}><input value={q} onFocus={()=>q.trim().length>=2&&setOpen(true)} onChange={e=>{setQ(e.target.value);setOpen(e.target.value.trim().length>=2)}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.min(i+1,items.length-1))}if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(i-1,-1))}if(e.key==='Escape')close()}} placeholder="Search players…" aria-label="Search all players"/><button aria-label="Search">⌕</button>{open&&q.trim().length>=2&&<div className="global-search-results" role="listbox">{loading?<p>Searching…</p>:items.length?items.map((p,i)=><button type="button" key={p.id} className={active===i?"active":""} onMouseDown={()=>go(`/players/${p.id}`)}><b>{p.name}</b><small>{p.club?.name??'Free agent'} · {(p as Suggestion & {scope?: 'UZBEKISTAN' | 'OTHER'}).scope==='UZBEKISTAN'?'Uzbekistan Super League':'Other'}</small></button>):<p>No players found.</p>}</div>}</form>}
