import { describe, it, expect, beforeEach } from 'vitest';
import { clearSignupPlan, parsePlan, rememberSignupPlan, signupPlanDestination, subscribePath } from '@/lib/signup-plan';

describe('signup plan', () => {
  beforeEach(() => localStorage.clear());

  it('accepts only the paid plans', () => {
    expect(parsePlan('cloud')).toBe('cloud');
    expect(parsePlan('standard')).toBe('standard');
    expect(parsePlan('basic')).toBeNull();
    expect(parsePlan('<script>')).toBeNull();
    expect(parsePlan(null)).toBeNull();
  });

  it('carries the plan to checkout until cleared', () => {
    rememberSignupPlan('cloud', 1_000);
    expect(signupPlanDestination(2_000)).toBe(subscribePath('cloud'));
    expect(signupPlanDestination(3_000)).toBe(subscribePath('cloud'));
    clearSignupPlan();
    expect(signupPlanDestination(4_000)).toBeNull();
  });

  it('forgets a choice more than a week old', () => {
    rememberSignupPlan('standard', 0);
    expect(signupPlanDestination(8 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it('ignores anything it did not write', () => {
    localStorage.setItem('homecast-signup-plan', '{"plan":"enterprise","at":1}');
    expect(signupPlanDestination(2)).toBeNull();
    localStorage.setItem('homecast-signup-plan', 'not json');
    expect(signupPlanDestination(2)).toBeNull();
  });
});
