import { memo, lazy, useState, useMemo, Suspense } from 'react';
import * as Ariakit from '@ariakit/react';
import { useLocation } from 'react-router-dom';
import { EModelEndpoint } from 'librechat-data-provider';
import { ChevronDown, SquarePen, SlidersHorizontal } from 'lucide-react';
import { Skeleton, Sidebar, Button, DropdownPopup, TooltipAnchor } from '@librechat/client';
import type * as t from '~/common';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { useActivePanel, resolveActivePanel, DEFAULT_PANEL } from '~/Providers';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import { useSidebarNewChat } from './ExpandedPanel';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const AccountSettings = lazy(() => import('~/components/Nav/AccountSettings'));

/** Panels that keep a row of their own; every other panel moves into the Customize menu. */
const PRIMARY_PANELS = new Set<string>([DEFAULT_PANEL, EModelEndpoint.agents]);

const rowClasses =
  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-sm text-text-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary';

function PanelRow({
  link,
  isActive,
  onSelect,
}: {
  link: t.NavLink;
  isActive: boolean;
  onSelect: (link: t.NavLink) => void;
}) {
  const localize = useLocalize();
  return (
    <button
      type="button"
      aria-pressed={isActive}
      disabled={link.disabled}
      data-testid={`minimal-nav-${link.id}`}
      className={cn(rowClasses, isActive && 'bg-surface-active-alt')}
      onClick={() => onSelect(link)}
    >
      <link.icon className="h-4 w-4 text-text-secondary" aria-hidden="true" />
      <span className="truncate">{localize(link.title)}</span>
    </button>
  );
}

/**
 * The expanded sidebar of the minimal layout: text rows for a new chat, the chats
 * list and agents, with every other panel behind one Customize menu, and the
 * account row at the bottom. The panel picked here renders below these rows.
 */
function MinimalPanel({
  links,
  children,
  onCollapse,
  onLeaveInsights,
}: {
  links: t.NavLink[];
  children: React.ReactNode;
  onCollapse: () => void;
  onLeaveInsights: () => void;
}) {
  const localize = useLocalize();
  const location = useLocation();
  const { active, setActive } = useActivePanel();
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const effectiveActive = resolveActivePanel(active, links);
  const isInsightsRoute = location.pathname.startsWith('/insights');
  const { handleNewChatClick } = useSidebarNewChat(setActive);
  const newChatAriaKey = useShortcutAriaKey('newChat');
  const toggleSidebarHint = useShortcutHint('toggleSidebar', localize('com_nav_close_sidebar'));
  const toggleSidebarAriaKey = useShortcutAriaKey('toggleSidebar');

  const { primaryLinks, customizeLinks } = useMemo(
    () =>
      links.reduce<{ primaryLinks: t.NavLink[]; customizeLinks: t.NavLink[] }>(
        (groups, link) => {
          (PRIMARY_PANELS.has(link.id) ? groups.primaryLinks : groups.customizeLinks).push(link);
          return groups;
        },
        { primaryLinks: [], customizeLinks: [] },
      ),
    [links],
  );

  const isLinkActive = (link: t.NavLink) =>
    link.id === 'insights' ? isInsightsRoute : !isInsightsRoute && link.id === effectiveActive;

  const handleSelect = (link: t.NavLink) => {
    if (link.onClick) {
      link.onClick();
      return;
    }
    setActive(link.id);
    if (isInsightsRoute) {
      onLeaveInsights();
    }
  };

  const customizeItems: t.MenuItemProps[] = customizeLinks.map((link) => ({
    id: `minimal-customize-${link.id}`,
    label: localize(link.title),
    icon: <link.icon className="size-4 text-text-secondary" aria-hidden="true" />,
    disabled: link.disabled,
    ariaChecked: isLinkActive(link),
    className: isLinkActive(link) ? 'bg-surface-active' : undefined,
    onClick: () => handleSelect(link),
  }));
  const isCustomizeActive = customizeLinks.some(isLinkActive);

  return (
    <div className="flex h-full w-full flex-col bg-surface-primary-alt high-contrast:border-r high-contrast:border-border-light">
      <div className="flex flex-col gap-0.5 px-2 pb-2 pt-2">
        <TooltipAnchor
          side="right"
          description={toggleSidebarHint}
          render={
            <Button
              id={CLOSE_SIDEBAR_ID}
              data-testid="close-sidebar-button"
              size="icon"
              variant="ghost"
              aria-label={localize('com_nav_close_sidebar')}
              aria-expanded={true}
              aria-keyshortcuts={toggleSidebarAriaKey}
              className="mb-1 h-9 w-9 rounded-lg"
              onClick={onCollapse}
            >
              <Sidebar aria-hidden="true" className="h-5 w-5 text-text-primary" />
            </Button>
          }
        />
        <a
          href="/c/new"
          data-testid="new-chat-button"
          aria-keyshortcuts={newChatAriaKey}
          className={rowClasses}
          onClick={handleNewChatClick}
        >
          <SquarePen className="h-4 w-4 text-text-secondary" aria-hidden="true" />
          <span>{localize('com_ui_new_chat')}</span>
        </a>
        {primaryLinks.map((link) => (
          <PanelRow
            key={link.id}
            link={link}
            isActive={isLinkActive(link)}
            onSelect={handleSelect}
          />
        ))}
        {customizeItems.length > 0 && (
          <DropdownPopup
            portal={true}
            menuId="minimal-customize-menu"
            focusLoop={true}
            unmountOnHide={true}
            isOpen={isCustomizeOpen}
            setIsOpen={setIsCustomizeOpen}
            items={customizeItems}
            trigger={
              <Ariakit.MenuButton
                data-testid="minimal-nav-customize"
                aria-expanded={isCustomizeOpen}
                className={cn(rowClasses, isCustomizeActive && 'bg-surface-active-alt')}
              >
                <SlidersHorizontal className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                <span className="flex-1 text-left">{localize('com_ui_customize')}</span>
                <ChevronDown className="h-4 w-4 text-text-secondary" aria-hidden="true" />
              </Ariakit.MenuButton>
            }
          />
        )}
      </div>
      <nav className="min-h-0 flex-1 overflow-hidden">{children}</nav>
      <div className="px-2 pb-2">
        <Suspense fallback={<Skeleton className="h-9 w-full rounded-lg" />}>
          <AccountSettings />
        </Suspense>
      </div>
    </div>
  );
}

export default memo(MinimalPanel);
