// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BlogComments } from '@/components/blog/BlogComments';
import { readCommentsConfig, type CommentsConfig } from '../comments';

const config: CommentsConfig = { repo: 'example/blog', repoId: 'R_test', category: 'Blog', categoryId: 'DIC_test' };
afterEach(cleanup);

function openComments(container: HTMLElement) {
  const details = container.querySelector('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

describe('blog comments', () => {
  it('hides an incomplete configuration instead of loading a broken widget', () => {
    expect(readCommentsConfig({ ...config, repoId: '' })).toBeNull();
    expect(readCommentsConfig({ ...config, repo: 'https://example.com' })).toBeNull();
    const { container } = render(<BlogComments slug="first" config={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('loads only on opening, with a stable post path rather than the title or query string', () => {
    const { container } = render(<BlogComments slug="first" config={config} />);
    expect(container.querySelector('script')).toBeNull();
    openComments(container);
    const script = container.querySelector('script')!;
    expect(script.src).toBe('https://giscus.app/client.js');
    expect(script.getAttribute('data-mapping')).toBe('specific');
    expect(script.getAttribute('data-term')).toBe('/blog/first/');
    expect(script.getAttribute('data-strict')).toBe('1');
    expect(script.getAttribute('data-repo-id')).toBe('R_test');
    const details = container.querySelector('details')!;
    details.open = false;
    fireEvent(details, new Event('toggle'));
    expect(container.querySelector('script')).toBe(script); // Keep an unfinished reply.
  });

  it('cleans up the previous post thread and starts the next one collapsed', () => {
    const { container, rerender, unmount } = render(<BlogComments key="first" slug="first" config={config} />);
    openComments(container);
    const host = container.querySelector('.giscus')!;
    host.append(document.createElement('iframe'));
    rerender(<BlogComments key="second" slug="second" config={config} />);
    expect(host.children).toHaveLength(0);
    expect(container.querySelector('script')).toBeNull();
    openComments(container);
    expect(container.querySelector('script')?.getAttribute('data-term')).toBe('/blog/second/');
    unmount();
    expect(document.querySelector('.giscus')).toBeNull();
  });

  it('offers a GitHub link if the comment script cannot load', () => {
    const { container } = render(<BlogComments slug="first" config={config} />);
    openComments(container);
    fireEvent.error(container.querySelector('script')!);
    expect(screen.getByRole('link', { name: 'Read or reply on GitHub' }).getAttribute('href')).toBe('https://github.com/example/blog/discussions');
  });
});
