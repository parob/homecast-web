import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExpandedOverlay } from '../../src/components/shared/ExpandedOverlay';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../../src/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle } from '../../src/components/ui/dialog';
import '../../src/index.css';

function Fixture() {
  const [opened, setOpened] = useState(false);
  const [nested, setNested] = useState(false);
  const [dialog, setDialog] = useState(false);
  const innerScroll = new URLSearchParams(location.search).has('inner');
  return <>
    <header data-expanded-overlay-dismiss style={{ position: 'fixed', inset: '0 0 auto', zIndex: 10040, display: 'flex', justifyContent: 'space-between', padding: 16, pointerEvents: 'none' }}>
      {['Home title', 'Header menu'].map(name => <DropdownMenu key={name}>
        <DropdownMenuTrigger asChild><button style={{ pointerEvents: 'auto' }}>{name}</button></DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem>{name} action</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>)}
    </header>
    <main data-page-scroller style={innerScroll ? { position: 'fixed', inset: 0, overflowY: 'auto' } : undefined}>
      <div style={{ height: 2500, padding: '200px 24px' }}>
        <div style={{ width: 200 }}>
          <button onClick={() => setOpened(true)}>Open widget</button>
          <ExpandedOverlay isExpanded={opened} onClose={() => { setOpened(false); setNested(false); }}>
            <section data-panel-content style={{ height: 1600, padding: '100px 24px' }}>
              <button onClick={() => setOpened(false)}>Close widget</button>
              <button onClick={() => setDialog(true)}>Open dialog</button>
              <div>
                <button onClick={() => setNested(true)}>Open nested widget</button>
                <ExpandedOverlay isExpanded={nested} onClose={() => setNested(false)}>
                  <div style={{ height: 1200, padding: '100px 24px' }}><button onClick={() => setNested(false)}>Close nested widget</button></div>
                </ExpandedOverlay>
              </div>
            </section>
          </ExpandedOverlay>
        </div>
      </div>
    </main>
    <Dialog open={dialog} onOpenChange={setDialog}>
      <DialogContent><DialogTitle>Widget dialog</DialogTitle><div data-dialog-scroll style={{ height: 160, overflowY: 'auto' }}><div style={{ height: 1200 }}>Scrollable dialog content</div></div></DialogContent>
    </Dialog>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
