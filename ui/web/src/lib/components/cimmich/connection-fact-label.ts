type ConnectionLabelModifier = { behavior: 'historical' | 'qualifier'; label: string };

export const formatCimmichConnectionFactLabel = ({
  label,
  modifiers,
  pastLabel,
  validity,
}: {
  label: string;
  modifiers: ConnectionLabelModifier[];
  pastLabel?: string | null;
  validity: 'current' | 'past' | 'timeless';
}) => {
  const hasHistoricalModifier = modifiers.some(({ behavior }) => behavior === 'historical');
  const base = validity === 'past' && !hasHistoricalModifier ? pastLabel || label : label;
  const modifierLabels = modifiers.map(({ label: modifierLabel }) => modifierLabel);
  return modifierLabels.length > 0 ? `${base} (${modifierLabels.join(', ')})` : base;
};
