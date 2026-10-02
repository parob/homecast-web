// @vitest-environment jsdom
//
// In-app account deletion — App Store guideline 5.1.1(v), homecast-cloud#214.
// Pinned: the password is required, a refusal keeps the dialog open with the
// server's reason, success hands over to sign-out, and an App Store
// subscriber is told before deleting that we cannot cancel Apple's billing.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DeleteAccountView, type DeleteAccountViewProps } from '../DeleteAccountSection';

afterEach(cleanup);

function setup(over: Partial<DeleteAccountViewProps> = {}) {
  const props: DeleteAccountViewProps = {
    accountType: 'standard',
    subscriptionSource: null,
    onDelete: vi.fn().mockResolvedValue({ success: true }),
    onDeleted: vi.fn(),
    onManageAppleSubscription: vi.fn(),
    ...over,
  };
  render(<DeleteAccountView {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
  return props;
}

const confirmButton = () => screen.getByRole('button', { name: /delete account/i });
const passwordField = () => screen.getByLabelText(/enter your password/i);

describe('DeleteAccountView', () => {
  it('cannot be confirmed without a password', () => {
    setup();
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the password and signs out once the account is gone', async () => {
    const props = setup();
    fireEvent.change(passwordField(), { target: { value: 'hunter2' } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(props.onDeleted).toHaveBeenCalled());
    expect(props.onDelete).toHaveBeenCalledWith('hunter2');
  });

  it("keeps the dialog open with the server's reason when refused", async () => {
    const props = setup({
      onDelete: vi.fn().mockResolvedValue({ success: false, error: 'That password is not correct.' }),
    });
    fireEvent.change(passwordField(), { target: { value: 'wrong' } });
    fireEvent.click(confirmButton());
    expect((await screen.findByRole('alert')).textContent).toContain('That password is not correct.');
    expect(props.onDeleted).not.toHaveBeenCalled();
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports a failed request rather than hanging', async () => {
    setup({ onDelete: vi.fn().mockRejectedValue(new Error('Network down')) });
    fireEvent.change(passwordField(), { target: { value: 'pw' } });
    fireEvent.click(confirmButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Network down');
  });

  it('warns an App Store subscriber that Apple billing is theirs to cancel', () => {
    const props = setup({ subscriptionSource: 'apple' });
    expect(screen.getByTestId('apple-subscription-warning').textContent).toMatch(/does not cancel/i);
    fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }));
    expect(props.onManageAppleSubscription).toHaveBeenCalled();
    expect(screen.queryByTestId('stripe-subscription-note')).toBeNull();
  });

  it('tells a Stripe subscriber the subscription ends now', () => {
    setup({ subscriptionSource: 'stripe' });
    expect(screen.getByTestId('stripe-subscription-note')).toBeTruthy();
    expect(screen.queryByTestId('apple-subscription-warning')).toBeNull();
  });

  it('tells a cloud-plan customer to remove the relay from Apple Home', () => {
    setup({ accountType: 'cloud' });
    expect(screen.getByTestId('cloud-relay-note').textContent).toMatch(/Apple Home/);
  });
});

describe('DeleteAccountView on the waitlist screen', () => {
  // 104 of 117 production accounts were waitlisted on 2026-10-02, and the
  // waitlist screen has no Settings — so this button is their only route.
  it('is a bare button that opens the same confirmation', async () => {
    const onDelete = vi.fn().mockResolvedValue({ success: true });
    const onDeleted = vi.fn();
    render(
      <DeleteAccountView
        variant="button"
        accountType="waitlist"
        subscriptionSource={null}
        onDelete={onDelete}
        onDeleted={onDeleted}
        onManageAppleSubscription={vi.fn()}
      />,
    );
    expect(screen.queryByText(/permanently delete your account and all its data/i)).toBeNull();
    const open = screen.getAllByRole('button', { name: /delete account/i });
    expect(open).toHaveLength(1);
    fireEvent.click(open[0]);
    fireEvent.change(screen.getByLabelText(/enter your password/i), { target: { value: 'pw' } });
    const buttons = screen.getAllByRole('button', { name: /delete account/i });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(onDelete).toHaveBeenCalledWith('pw');
  });
});
