import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Cimmich typed connection facts', () => {
  it('keeps recorded facts, custom labels, dates and removal in one local editor', async () => {
    const editor = await readFile('src/lib/components/cimmich/CimmichConnectionFactEditor.svelte', 'utf8');
    expect(editor).toContain('How is {targetName} connected to {personName}?');
    expect(editor).toContain('Create your own');
    expect(editor).toContain("'Former relationship'");
    expect(editor).toContain('Connection modifiers');
    expect(editor).toContain('Create modifier');
    expect(editor).toContain('Childhood or School');
    expect(editor).toContain('modifierIds: selectedModifierIds');
    expect(editor).toContain('Linked context');
    expect(editor).toContain('The same context can connect several People.');
    expect(editor).toContain("contextIds: targetKind === 'person' ? selectedContextIds : undefined");
    expect(editor).toContain('Link a Place, event, life period or thing');
    expect(editor).toContain("getCimmichContextEntities('places'");
    expect(editor).toContain('aria-label={`Edit ${fact.displayLabel}`}');
    expect(editor).toContain('selectedModifierIds = fact.modifiers.map');
    expect(editor).toContain("editingFactId ? 'Update' : 'Record'");
    expect(editor).toContain('recordCimmichConnectionFact');
    expect(editor).toContain('retractCimmichConnectionFact');
    expect(editor).toContain('formatCimmichConnectionFactLabel');
    expect(editor).toContain('const existingFact = facts.find');
    expect(editor).toContain('editFact(existingFact)');
    expect(editor).toContain('Relationship time');
    expect(editor).toContain('Current: ${selectedType.label}');
    expect(editor).toContain('Past: ${selectedType.pastLabel || selectedType.label}');
    expect(editor).toContain("selectedType?.temporalMode === 'current_or_past' ? validity : 'current'");
  });

  it('reviews one atomic shared hub command for several People', async () => {
    const [editor, service] = await Promise.all([
      readFile('src/lib/components/cimmich/CimmichConnectionHubEditor.svelte', 'utf8'),
      readFile('src/lib/services/cimmich-connection-facts.service.ts', 'utf8'),
    ]);
    expect(editor).toContain('Add several people');
    expect(editor).toContain('Link people to the same home, employer or group');
    expect(editor).toContain("CimmichConnectionHubKind>('home')");
    expect(editor).toContain("label: 'Employer'");
    expect(editor).toContain("label: 'Group'");
    expect(editor).toContain('Each Person can have their own role, dates and modifiers.');
    expect(editor).toContain('Review before recording');
    expect(editor).toContain('If any row is invalid, none are saved.');
    expect(editor).toContain('recordCimmichConnectionHub');
    expect(editor).toContain('formatCimmichConnectionFactLabel');
    expect(service).toContain("'/v1/connection-hubs:record'");
    expect(service).toContain("CimmichConnectionTargetKind = 'object' | 'person' | 'place'");
  });

  it('shows explainable candidates inline and never records them without Confirm', async () => {
    const suggestions = await readFile('src/lib/components/cimmich/CimmichConnectionSuggestions.svelte', 'utf8');
    const card = await readFile('src/lib/components/cimmich/CimmichPersonConnectionCard.svelte', 'utf8');
    expect(suggestions).toContain('Possible connections to confirm');
    expect(suggestions).toContain('Nothing is added unless you confirm it.');
    expect(suggestions).toContain('suggestion.explanation');
    expect(suggestions).toContain('recordCimmichConnectionFact');
    expect(suggestions).toContain('dismissCimmichConnectionSuggestion');
    expect(card).toContain('Describe connection');
  });
});
