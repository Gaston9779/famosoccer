"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  retry?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const recover = retry ?? reset;

  return (
    <div className="app-error" role="alert">
      <p className="eyebrow">Something went wrong</p>
      <h1>We couldn&apos;t load this view</h1>
      <p>
        The data service returned an unexpected error. This is usually temporary — try again in a moment.
      </p>
      {error.digest && <p className="app-error-ref">Reference: {error.digest}</p>}
      <div className="app-error-actions">
        {recover && (
          <button type="button" className="app-error-retry" onClick={() => recover()}>
            Try again
          </button>
        )}
        <a href="/" className="app-error-home">
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
