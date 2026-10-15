import { useState } from 'react';

export function Hero() {
  const [clicks, setClicks] = useState(0);

  return (
    <header className="hero">
      <h1>Ship calmer releases</h1>
      <p className="lede">
        Harbor keeps your deploys, previews and rollbacks in one quiet place.
      </p>
      <button className="button" type="button" onClick={() => setClicks((n) => n + 1)}>
        Get started{clicks > 0 ? ` (${clicks})` : ''}
      </button>
    </header>
  );
}
