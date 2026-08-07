import { describe, expect, it } from 'vitest';
import { personAuditDecision } from './person-audit-decision';

const item = {
  assignedPerson: { displayName: 'Tony Beranek', personId: 'tony', reference: null, score: 0.4 },
  faceId: 'face-1',
  suggestedPerson: { displayName: 'Vito Mazzarino', personId: 'vito', reference: null, score: 0.8 },
};

describe('person audit decision', () => {
  it('makes the matcher suggestion the default one-click correction', () => {
    const decision = personAuditDecision(item, {}, {}, []);

    expect(decision.targetPersonId).toBe('vito');
    expect(decision.label).toBe('Change to Vito Mazzarino');
  });

  it('names keeping the existing identity as an explicit decision', () => {
    const decision = personAuditDecision(item, { 'face-1': 'tony' }, {}, []);

    expect(decision.target?.display_name).toBe('Tony Beranek');
    expect(decision.label).toBe('Leave as Tony Beranek');
  });

  it('names a selected third person in the primary action', () => {
    const decision = personAuditDecision(item, { 'face-1': 'aga' }, {}, [
      { display_name: 'Aga Zejden', person_id: 'aga' },
    ]);

    expect(decision.label).toBe('Change to Aga Zejden');
  });
});
