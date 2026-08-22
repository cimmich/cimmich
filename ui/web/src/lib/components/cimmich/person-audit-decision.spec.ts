import { describe, expect, it } from 'vitest';
import { personAuditDecision } from './person-audit-decision';

const item = {
  assignedPerson: { displayName: 'Alex Chen', personId: 'alex', reference: null, score: 0.4 },
  faceId: 'face-1',
  suggestedPerson: { displayName: 'Nora Vale', personId: 'nora', reference: null, score: 0.8 },
};

describe('person audit decision', () => {
  it('makes the matcher suggestion the default one-click correction', () => {
    const decision = personAuditDecision(item, {}, {}, []);

    expect(decision.targetPersonId).toBe('nora');
    expect(decision.label).toBe('Change to Nora Vale');
  });

  it('names keeping the existing identity as an explicit decision', () => {
    const decision = personAuditDecision(item, { 'face-1': 'alex' }, {}, []);

    expect(decision.target?.display_name).toBe('Alex Chen');
    expect(decision.label).toBe('Leave as Alex Chen');
  });

  it('names a selected third person in the primary action', () => {
    const decision = personAuditDecision(item, { 'face-1': 'maya' }, {}, [
      { display_name: 'Maya Chen', person_id: 'maya' },
    ]);

    expect(decision.label).toBe('Change to Maya Chen');
  });
});
