import { createRoot } from 'react-dom/client';
import { LocalSharedContentEditor } from '../../components/SharedContentEditor';
import './shared-content.css';

createRoot(document.getElementById('shared-content-root')!).render(<>
  {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- standalone gateway entry requires a full page load */}
  <nav style={{ padding: '20px 32px' }}><a href="/art/review" style={{ color: '#d7ae5f' }}>← Faction Studio</a></nav>
  <LocalSharedContentEditor />
</>);
