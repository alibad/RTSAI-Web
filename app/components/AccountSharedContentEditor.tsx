"use client";

import { useAuth } from './AuthProvider';
import { ContentEditor } from './SharedContentEditor';

export function SharedContentEditor() {
  const { user, openAuth } = useAuth();
  return <ContentEditor authorize={async () => {
    if (!user) { openAuth('Sign in as a Studio administrator'); return null; }
    return { Authorization: `Bearer ${await user.getIdToken()}` };
  }} signedIn={!!user} />;
}
