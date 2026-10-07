/**
 * Whether a key press belongs to a field: text inputs, and the UI kit's selects and comboboxes (their triggers have
 * role="combobox", their open lists role="listbox"). Studio shortcuts (J/K, 1–8, U/N/R/C, Space, arrows, Escape) skip
 * these, as they skipped native <select>s, so typing "u" in a faction search or picking from a list never decides.
 */
export function isFieldKey(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return Boolean(target?.isContentEditable || target?.closest?.("input, textarea, select, [role=combobox], [role=listbox]"));
}
