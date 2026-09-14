import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from './index';

const NAMES = [
  'Home', 'Upload', 'Folder', 'FolderOpen', 'Calendar', 'ListCheck', 'CheckCircle',
  'User', 'Search', 'Bell', 'Trash', 'Pencil', 'Close', 'ChevronDown',
  'ChevronRight', 'ArrowLeft', 'FileText', 'Inbox', 'Lock', 'Sparkle',
];

describe('아이콘 세트', () => {
  it('20종이 모두 export되어 있다', () => {
    NAMES.forEach((n) => expect(typeof icons[n]).toBe('function'));
    expect(NAMES).toHaveLength(20);
  });

  it('모든 아이콘이 svg를 렌더하고 currentColor를 쓴다', () => {
    NAMES.forEach((n) => {
      const html = renderToStaticMarkup(icons[n]({}));
      expect(html).toContain('<svg');
      expect(html).toContain('currentColor');
      expect(html).toContain('viewBox="0 0 24 24"');
    });
  });

  it('size prop이 width/height에 반영된다', () => {
    const html = renderToStaticMarkup(icons.Home({ size: 32 }));
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
  });
});
