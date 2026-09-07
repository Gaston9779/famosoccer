export const dynamic = 'force-dynamic';
import { AppShell } from "@/components/app-shell";
import "./globals.css";
import "./visual.css";
import "./shell.css";
import "./responsive.css";
import "./mobile.css";
export const metadata = {
  title: "Famosoccer · Uzbekistan scouting",
  description: "Private scouting data diagnostic",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
