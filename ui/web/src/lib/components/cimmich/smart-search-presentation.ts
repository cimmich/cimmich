export const smartSearchEntityLabel = (entityKind: string) =>
  ({
    document: 'Document',
    event: 'Event',
    object: 'Thing',
    person: 'Person',
    pet: 'Pet',
    place: 'Place',
  })[entityKind] ?? 'Recorded detail';

export const smartSearchMatchLabel = (matchKind: string) =>
  ({
    description: 'Description',
    exact_alias: 'Exact alias',
    exact_display_name: 'Exact name',
    exact_name: 'Exact name',
    label: 'Exact name or alias',
    title: 'Title',
  })[matchKind] ?? 'Recorded detail';
