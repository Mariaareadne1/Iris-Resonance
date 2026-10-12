import { createRoot } from 'react-dom/client';
import { App } from './components/App.tsx';
import './styles.css';

const params = new URLSearchParams(window.location.search);
const flag = (name: string) => ['1', 'true', 'yes'].includes((params.get(name) ?? '').toLowerCase());

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(<App embed={flag('embed')} debug={flag('debug') || import.meta.env.DEV} />);
