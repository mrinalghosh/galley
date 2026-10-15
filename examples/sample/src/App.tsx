import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { CardRow } from './components/CardRow';
import { SignupForm } from './components/SignupForm';
import { ErrorButtons } from './components/ErrorButtons';

export function App() {
  return (
    <>
      <Nav />
      <main className="page">
        <Hero />
        <CardRow />
        <section className="panel">
          <h2>Get updates</h2>
          <SignupForm />
        </section>
        <section className="panel">
          <h2>Console capture</h2>
          <p className="muted">These buttons fail on purpose, for testing error capture.</p>
          <ErrorButtons />
        </section>
      </main>
    </>
  );
}
