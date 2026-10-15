// galley CLI entry. Commands live in commands.ts.
import { main } from './commands.js';

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`galley: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
