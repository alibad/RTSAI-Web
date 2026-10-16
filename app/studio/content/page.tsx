import { notFound } from 'next/navigation';
import { ADMIN_BUILD } from '../../../lib/admin';
import { SharedContentEditor } from '../../components/AccountSharedContentEditor';
import './shared-content.css';

export const metadata = { title: 'Shared content · RTS AI Studio', robots: { index: false, follow: false } };

export default function SharedContentPage() {
  if (!ADMIN_BUILD) notFound();
  return <SharedContentEditor />;
}
