type CardProps<T extends string> = {
  title: T;
  body: string;
};

export function Card<T extends string>({ title, body }: CardProps<T>) {
  return (
    <article className="card">
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}
