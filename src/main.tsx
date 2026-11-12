import { createRoot } from 'react-dom/client';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import './ui/styles.css';
import App from './App';

// No StrictMode: the Three.js engine owns a WebGL context and must not be double-instantiated in dev.
createRoot(document.getElementById('root')!).render(<App />);
