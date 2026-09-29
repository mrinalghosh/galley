// Shell page entry: toolbar, framed site and terminal drawer. The HTML itself
// comes from the server (src/server/static.ts).
import { render } from 'preact';
import { App } from './App.js';
import { styles } from './styles.js';

const style = document.createElement('style');
style.textContent = styles;
document.head.append(style);

const root = document.getElementById('galley-shell');
if (root) render(<App />, root);
