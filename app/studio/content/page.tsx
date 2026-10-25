import { AdminGate } from '../../components/AdminGate';
import { SharedContentEditor } from '../../components/AccountSharedContentEditor';
import { ADMIN_BUILD } from '../../../lib/admin';
import './shared-content.css';

export const metadata = { title: 'Shared content · RTS AI Studio', robots: { index: false, follow: false } };

// Admin tool that needs this machine (lib/admin.ts): it writes the mod on disk. On rtsai.net the owner gets a card
// naming the local Studio, and vite.config.ts stubs the editor out of the public bundle.
export default function SharedContentPage() {
  return <AdminGate surface="content">{ADMIN_BUILD && <SharedContentEditor />}</AdminGate>;
}
