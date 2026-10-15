// Opens a URL in the default browser. Best effort: failures only print a hint.
import { spawn } from 'node:child_process';

export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.error(`galley: couldn't open a browser; visit ${url}`));
  child.unref();
}
