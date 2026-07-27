/**
 * The automation.test request must carry homeId.
 *
 * The server routes a relay request one of two ways:
 *   - payload has homeId -> get_device_id_for_home(home, user)
 *   - otherwise          -> get_user_device_id(user)
 *
 * The client used to send only { automationId, triggerData }, forcing the
 * user-level lookup. That finds nothing for a cloud-managed relay, because the
 * relay Mac belongs to the operator rather than to the customer — so pressing
 * "Run Test" answered "No relay device connected" while a perfectly healthy
 * relay was serving that very home. Verified against production:
 *
 *   get_user_device_id(customer)                 -> None
 *   get_device_id_for_home(their home, customer) -> ('mac_8ca2d5a2…', 'admin')
 *
 * Same failure applies to any shared home, where the relay belongs to the
 * home's owner rather than the member running the test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PANEL = 'src/components/automation-editor/panels/NodeConfigPanel.tsx';
const DIALOG = 'src/components/automation-editor/AutomationEditorDialog.tsx';

describe('automation.test routing payload', () => {
  it('sends homeId alongside automationId', () => {
    const src = readFileSync(PANEL, 'utf8');
    const call = src.slice(src.indexOf("'automation.test'"));

    // The payload object immediately following the action name.
    const payload = call.slice(call.indexOf('{'), call.indexOf('}') + 1);
    expect(payload).toContain('automationId');
    expect(payload).toContain('homeId');
  });

  it('accepts homeId as a prop so it has something to send', () => {
    expect(readFileSync(PANEL, 'utf8')).toMatch(/homeId\?:\s*string/);
  });

  it('is given homeId by the editor dialog', () => {
    const src = readFileSync(DIALOG, 'utf8');
    const usage = src.slice(src.indexOf('<NodeConfigPanel'));
    const props = usage.slice(0, usage.indexOf('/>'));

    expect(props).toContain('homeId={homeId}');
  });
});

describe('relay-mode messaging must not pre-empt the request', () => {
  /**
   * A relay-capable Mac with relay mode switched off is the NORMAL setup for a
   * cloud-managed customer — their relay is a different machine. Short-circuiting
   * on that condition blocked the very request that would have routed correctly
   * to the managed relay, turning a working path into "Relay is turned off on
   * this Mac".
   *
   * The local-toggle hint belongs on the failure path only.
   */
  function testHandlerSource(): string {
    const src = readFileSync(PANEL, 'utf8');
    const start = src.indexOf('const engine = getAutomationEngine();');
    return src.slice(start, src.indexOf('finally', start));
  }

  it('does not branch on relay mode before attempting the request', () => {
    const body = testHandlerSource();
    const beforeRequest = body.slice(0, body.indexOf("'automation.test'"));

    expect(beforeRequest).not.toMatch(/isRelayEnabled\(\)/);
  });

  it('still reaches the server request when relay mode is off locally', () => {
    const body = testHandlerSource();
    const beforeRequest = body.slice(0, body.indexOf("'automation.test'"));

    // No early return between resolving the engine and issuing the request.
    expect(beforeRequest).not.toMatch(/\breturn;/);
  });

  it('explains the local toggle only after a no-relay failure', () => {
    const src = readFileSync(PANEL, 'utf8');
    const catchBlock = src.slice(src.indexOf('} catch (e) {'), src.indexOf('} finally {'));

    expect(catchBlock).toMatch(/no relay device/i);
    expect(catchBlock).toMatch(/isRelayEnabled\(\)/);
  });
});
