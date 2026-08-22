import '@testing-library/jest-dom';
import { fireEvent, waitFor } from '@testing-library/svelte';
import { renderWithTooltips } from '$tests/helpers';
import CimmichPersonConnectionAdd from './CimmichPersonConnectionAdd.svelte';

Object.defineProperty(globalThis, 'visualViewport', {
  configurable: true,
  value: {
    addEventListener: vi.fn(),
    height: 800,
    removeEventListener: vi.fn(),
  },
});

const mocks = vi.hoisted(() => ({
  attachRelations: vi.fn(),
  createEntity: vi.fn(),
  getEntities: vi.fn(),
  getConnectionTypes: vi.fn(),
  recordConnectionFact: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', () => ({
  attachCimmichContextRelations: mocks.attachRelations,
  createCimmichContextCommandId: (kind: string) => `context.${kind}.test`,
  createCimmichContextEntity: mocks.createEntity,
  getCimmichContextEntities: mocks.getEntities,
}));

vi.mock('$lib/services/cimmich-connection-facts.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/cimmich-connection-facts.service')>()),
  getCimmichConnectionTypes: mocks.getConnectionTypes,
  recordCimmichConnectionFact: mocks.recordConnectionFact,
}));

describe('CimmichPersonConnectionAdd', () => {
  beforeEach(() => {
    mocks.attachRelations.mockReset().mockResolvedValue({ status: 'applied' });
    mocks.createEntity.mockReset();
    mocks.getEntities.mockReset().mockResolvedValue([]);
    mocks.getConnectionTypes.mockReset().mockResolvedValue([]);
    mocks.recordConnectionFact.mockReset().mockResolvedValue({ fact: {}, replayed: false });
  });

  it('expands the open workspace to the full Connections width', async () => {
    const { getByRole } = renderWithTooltips(CimmichPersonConnectionAdd, {
      onchanged: vi.fn(),
      personId: 'person_1',
      personName: 'Alex',
    });

    const trigger = getByRole('button', { name: 'Add to' });
    expect(trigger).toHaveClass('justify-self-end');
    await fireEvent.click(trigger);

    expect(getByRole('region', { name: 'Add Alex to' })).toHaveClass('w-full');
  });

  it('adds the person to an existing Event', async () => {
    mocks.getEntities.mockResolvedValueOnce([
      { displayName: 'Birthday lunch', entityId: 'event_1', typeKind: 'event' },
    ]);
    const onchanged = vi.fn();
    const { getByRole } = renderWithTooltips(CimmichPersonConnectionAdd, {
      onchanged,
      personId: 'person_1',
      personName: 'Alex',
    });

    await fireEvent.click(getByRole('button', { name: 'Add to' }));
    await waitFor(() => expect(getByRole('combobox', { name: 'Existing event' })).toHaveValue('Birthday lunch'));
    await fireEvent.click(getByRole('button', { name: 'Add to event' }));

    await waitFor(() => expect(mocks.attachRelations).toHaveBeenCalledOnce());
    expect(mocks.attachRelations).toHaveBeenCalledWith('events', 'event_1', 'context.person-event-attach.test', [
      { relationKind: 'participant', targetId: 'person_1', targetKind: 'person' },
    ]);
    expect(onchanged).toHaveBeenCalledOnce();
  });

  it('creates a new Life period and connects the person from the same flow', async () => {
    mocks.createEntity.mockResolvedValueOnce({
      detail: { entity: { entityId: 'event_life_1' } },
      status: 'applied',
    });
    const onchanged = vi.fn();
    const { getByRole } = renderWithTooltips(CimmichPersonConnectionAdd, {
      onchanged,
      personId: 'person_1',
      personName: 'Alex',
    });

    await fireEvent.click(getByRole('button', { name: 'Add to' }));
    await fireEvent.click(getByRole('button', { name: 'Life period' }));
    await fireEvent.click(getByRole('tab', { name: 'Create new' }));
    await fireEvent.input(getByRole('textbox', { name: 'Life period name' }), {
      target: { value: 'Living in London' },
    });
    await fireEvent.click(getByRole('button', { name: 'Create life period & add' }));

    await waitFor(() => expect(mocks.createEntity).toHaveBeenCalledOnce());
    expect(mocks.createEntity).toHaveBeenCalledWith('events', {
      commandId: 'context.person-life_period-create.test',
      dateEnd: null,
      datePrecision: 'unknown',
      dateStart: null,
      displayName: 'Living in London',
      typeKind: 'life_period',
    });
    expect(mocks.attachRelations).toHaveBeenCalledWith(
      'events',
      'event_life_1',
      'context.person-life_period-attach.test',
      [{ relationKind: 'participant', targetId: 'person_1', targetKind: 'person' }],
    );
    expect(onchanged).toHaveBeenCalledOnce();
  });

  it('records an existing Place through typed Person connection facts instead of an invalid context relation', async () => {
    mocks.getEntities.mockResolvedValue([{ displayName: 'Willow House', entityId: 'place_1', typeKind: 'point' }]);
    mocks.getConnectionTypes.mockResolvedValue([
      { label: 'Lives here', targetKind: 'place', typeId: 'connectiontype_lives_here' },
      { label: 'Works here', targetKind: 'place', typeId: 'connectiontype_works_here' },
    ]);
    const onchanged = vi.fn();
    const { getByRole } = renderWithTooltips(CimmichPersonConnectionAdd, {
      onchanged,
      personId: 'person_1',
      personName: 'Maya Chen',
    });

    await fireEvent.click(getByRole('button', { name: 'Add to' }));
    await fireEvent.click(getByRole('button', { name: 'Place' }));
    const placePicker = await waitFor(() => {
      const picker = getByRole('combobox', { name: 'Existing place' });
      expect(picker).toHaveValue('Willow House');
      return picker;
    });
    const relationPicker = getByRole('combobox', { name: 'How Maya Chen is connected' });
    await waitFor(() => expect(relationPicker).toHaveValue('Lives here'));

    await fireEvent.focus(placePicker);
    await fireEvent.input(placePicker, { target: { value: 'Willow' } });
    await fireEvent.click(getByRole('option', { name: 'Willow House' }));
    await fireEvent.click(getByRole('button', { name: 'Add to place' }));

    await waitFor(() => expect(mocks.recordConnectionFact).toHaveBeenCalledOnce());
    expect(mocks.recordConnectionFact).toHaveBeenCalledWith('person_1', {
      commandId: 'context.person-place-connect.test',
      targetId: 'place_1',
      targetKind: 'place',
      typeId: 'connectiontype_lives_here',
    });
    expect(mocks.attachRelations).not.toHaveBeenCalled();
    expect(onchanged).toHaveBeenCalledWith('person_1');
  });
});
