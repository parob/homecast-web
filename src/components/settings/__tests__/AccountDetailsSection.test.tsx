// @vitest-environment jsdom
//
// Settings → Account: your name and your password (Cloud). Pinned: the name
// can be set and cleared, a password change needs the current password and a
// new one that passes the rules, and a refusal keeps the dialog open with the
// server's reason.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AccountDetailsView, type AccountDetailsViewProps } from '../AccountDetailsSection';

afterEach(cleanup);

const NEW_PASSWORD = 'N3w-password!';

function setup(over: Partial<AccountDetailsViewProps> = {}) {
  const props: AccountDetailsViewProps = {
    email: 'ada@example.com',
    name: 'Ada',
    onSaveName: vi.fn().mockResolvedValue({ success: true }),
    onChangePassword: vi.fn().mockResolvedValue({ success: true }),
    ...over,
  };
  const view = render(<AccountDetailsView {...props} />);
  return { props, view };
}

describe('AccountDetailsView — name', () => {
  it('shows the email and the name, or that no name is set', () => {
    setup({ name: null });
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByTestId('account-name').textContent).toBe('Not set');
  });

  it('saves an edited name and leaves edit mode', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.queryByLabelText(/^name$/i)).toBeNull());
    expect(props.onSaveName).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('can clear the name', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(props.onSaveName).toHaveBeenCalledWith('   '));
  });

  it('does not offer to save an unchanged name', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect((screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays in edit mode with the server's reason when refused", async () => {
    setup({ onSaveName: vi.fn().mockResolvedValue({ success: false, error: 'Name must be 100 characters or fewer.' }) });
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Someone' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('100 characters');
    expect(screen.getByLabelText(/^name$/i)).toBeTruthy();
  });
});

describe('AccountDetailsView — password', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: /^change$/i }));
  const confirm = () => screen.getByRole('button', { name: /change password/i }) as HTMLButtonElement;

  it('needs the current password and a new one that passes the rules', () => {
    setup();
    open();
    expect(confirm().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old-Pass1!' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'weak' } });
    expect(confirm().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: NEW_PASSWORD } });
    expect(confirm().disabled).toBe(false);
  });

  it('sends both passwords and closes on success', async () => {
    const { props } = setup();
    open();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old-Pass1!' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: NEW_PASSWORD } });
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.queryByLabelText(/current password/i)).toBeNull());
    expect(props.onChangePassword).toHaveBeenCalledWith('old-Pass1!', NEW_PASSWORD);
  });

  it("keeps the dialog open with the server's reason when refused", async () => {
    setup({ onChangePassword: vi.fn().mockResolvedValue({ success: false, error: 'Your current password is not correct.' }) });
    open();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: NEW_PASSWORD } });
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toContain('current password is not correct');
    expect(confirm().disabled).toBe(false);
  });

  it('reports a failed request rather than hanging', async () => {
    setup({ onChangePassword: vi.fn().mockRejectedValue(new Error('Network down')) });
    open();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old-Pass1!' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: NEW_PASSWORD } });
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toContain('Network down');
  });
});
