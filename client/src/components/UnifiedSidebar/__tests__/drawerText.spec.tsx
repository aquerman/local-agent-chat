import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { MINIMAL_DRAWER_TEXT, MOBILE_DRAWER_ID } from '../constants';
import UnifiedSidebar from '../UnifiedSidebar';

/**
 * The mobile drawer reuses the desktop sidebar's rows, written at `text-sm`,
 * which reads too small on a phone. The minimal layout steps the drawer's text
 * up one size; the stock layout keeps upstream's sizes.
 */

const mockLayout = { minimal: false };

jest.mock('@librechat/client', () => ({
  useMediaQuery: () => false,
}));

jest.mock('~/hooks/Nav/useSidebarState', () => ({
  __esModule: true,
  default: () => ({ isSmallScreen: true, expanded: true, setExpanded: jest.fn() }),
}));

jest.mock('~/hooks/Nav/useSidebarToggle', () => ({
  __esModule: true,
  default: () => ({ setSidebarOpen: jest.fn(), toggleSidebar: jest.fn() }),
}));

jest.mock('~/hooks/Nav/useUnifiedSidebarLinks', () => ({
  __esModule: true,
  default: () => [],
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useChatHelpers: () => ({}),
  useMinimalLayout: () => mockLayout.minimal,
}));

jest.mock('~/Providers', () => ({
  ChatContext: { Provider: ({ children }: { children: ReactNode }) => <>{children}</> },
  ChatFormProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ActivePanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('~/components/SidePanel/Nav', () => ({
  __esModule: true,
  default: () => <div data-testid="side-panel-nav" />,
}));

jest.mock('../mobile', () => ({
  MobileHeader: () => <div data-testid="mobile-header" />,
  MobileBottomBar: () => <div data-testid="mobile-bottom-bar" />,
  MobileShortcutTargets: () => <div data-testid="mobile-shortcut-targets" />,
}));

jest.mock('../Sidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="desktop-sidebar" />,
}));

const drawerClasses = (minimal: boolean): string => {
  mockLayout.minimal = minimal;
  const { unmount } = render(
    <MemoryRouter>
      <UnifiedSidebar />
    </MemoryRouter>,
  );
  const drawer = document.getElementById(MOBILE_DRAWER_ID);
  if (drawer == null) {
    throw new Error('the mobile drawer did not render');
  }
  const { className } = drawer;
  unmount();
  return className;
};

describe('mobile drawer text size', () => {
  it('steps the text up in the minimal layout', () => {
    expect(drawerClasses(true)).toContain(MINIMAL_DRAWER_TEXT);
  });

  it('keeps the stock sizes in the classic layout', () => {
    expect(drawerClasses(false)).not.toContain(MINIMAL_DRAWER_TEXT);
  });
});
