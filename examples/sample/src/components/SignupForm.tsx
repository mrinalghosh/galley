import { useState, type FormEvent } from 'react';

export function SignupForm() {
  const [sent, setSent] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSent(true);
  };

  if (sent) return <p className="notice">Thanks, you're on the list.</p>;

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span>Email</span>
        <input type="email" name="email" placeholder="you@example.com" required />
      </label>
      <label className="field">
        <span>Team size</span>
        <select name="size" defaultValue="small">
          <option value="small">1–10</option>
          <option value="medium">11–50</option>
          <option value="large">50+</option>
        </select>
      </label>
      <button className="button" type="submit">
        Subscribe
      </button>
    </form>
  );
}
