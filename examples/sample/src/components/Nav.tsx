const links = ['Features', 'Pricing', 'Docs'];

export function Nav() {
  return (
    <nav className="nav">
      <a className="brand" href="/">
        Harbor
      </a>
      <ul className="nav-links">
        {links.map((label) => (
          <li key={label}>
            <a href={`#${label.toLowerCase()}`}>{label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
