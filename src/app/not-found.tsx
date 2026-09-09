import Link from "next/link";

export default function NotFound() {
  return (
    <div className="app-error" role="alert">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>The page you requested doesn&apos;t exist or has been moved.</p>
      <div className="app-error-actions">
        <Link href="/" className="app-error-home">
          Back to dashboard
        </Link>
        <Link href="/players" className="app-error-home">
          Browse players
        </Link>
      </div>
    </div>
  );
}
