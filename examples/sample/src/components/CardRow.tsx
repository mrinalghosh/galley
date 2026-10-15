import { Card } from './Card';

const cards = [
  { title: 'Previews', body: 'Every branch gets its own URL, ready to share.' },
  { title: 'Rollbacks', body: 'Go back to any release in one click.' },
  { title: 'Insights', body: 'See what changed and who it affected.' },
] as const;

export function CardRow() {
  return (
    <section className="cards" id="features">
      {cards.map((card) => (
        <Card key={card.title} title={card.title} body={card.body} />
      ))}
    </section>
  );
}
