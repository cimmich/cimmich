import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordCimmichConnectionHub } from './cimmich-connection-facts.service';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cimmich connection hub client', () => {
  it('submits every reviewed member in one owner-authored command', async () => {
    const input = {
      commandId: 'connection-hub-command-1',
      displayName: 'Community Studio',
      hubKind: 'employer' as const,
      members: [
        {
          dateEnd: '2011-08-31',
          dateStart: '2010-01-01',
          modifierIds: ['modifier-school'],
          personId: 'person-alpha',
          typeId: 'connectiontype_works_for',
          validity: 'past' as const,
        },
        {
          modifierIds: [],
          personId: 'person-bravo',
          typeId: 'connectiontype_works_for',
          validity: 'current' as const,
        },
      ],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        createdHub: true,
        hub: {
          displayName: 'Community Studio',
          entityId: 'context-community-studio',
          entityKind: 'object',
          typeKind: 'organisation',
        },
        members: [],
        replayed: false,
        schemaVersion: 'cimmich.connection-facts.v4',
      }),
    );

    await recordCimmichConnectionHub(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3101/v1/connection-hubs:record',
      expect.objectContaining({
        body: JSON.stringify(input),
        headers: expect.objectContaining({ 'x-cimmich-actor': 'local-operator' }),
        method: 'POST',
      }),
    );
  });
});
