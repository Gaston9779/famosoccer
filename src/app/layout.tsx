import Link from "next/link";
import { SidebarNav } from "@/components/sidebar-nav";
import "./globals.css";
import "./visual.css";
import "./shell.css";
export const metadata = {
  title: "Famosoccer · Uzbekistan scouting",
  description: "Private scouting data diagnostic",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell"><aside className="sidebar"><Link href="/" className="brand"><b>◉</b>SOCCER<span>SCOUTING</span></Link><p className="workspace">PRIVATE WORKSPACE<br />UZBEKISTAN · UZ1</p><SidebarNav /><div className="sidebar-foot"><i>N</i><p>Commercial Intelligence<br /><span>for Scouting</span></p></div></aside>
          <div className="content"><header className="topbar"><form action="/players"><input name="q" aria-label="Search players" placeholder="Search player name…" /></form><span className="status-dot">LIVE DATABASE</span></header><main>{children}</main></div>
        </div>
      </body>
    </html>
  );
}
