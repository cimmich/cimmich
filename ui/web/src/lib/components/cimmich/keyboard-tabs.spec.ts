import { keyboardTabs } from './keyboard-tabs';

describe('keyboardTabs', () => {
  const setup = () => {
    const tablist = document.createElement('div');
    tablist.innerHTML =
      '<button role="tab">One</button><button role="tab">Two</button><button role="tab">Three</button>';
    document.body.append(tablist);
    const action = keyboardTabs(tablist);
    const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    return { action, tablist, tabs };
  };

  afterEach(() => document.body.replaceChildren());

  it('wraps with horizontal arrow keys and activates the destination', () => {
    const { action, tabs } = setup();
    const click = vi.fn();
    tabs[0]?.addEventListener('click', click);
    tabs[2]?.focus();
    tabs[2]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    expect(document.activeElement).toBe(tabs[0]);
    expect(click).toHaveBeenCalledOnce();
    action.destroy();
  });

  it('supports Home and End', () => {
    const { action, tabs } = setup();
    tabs[1]?.focus();
    tabs[1]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    expect(document.activeElement).toBe(tabs[2]);
    tabs[2]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
    expect(document.activeElement).toBe(tabs[0]);
    action.destroy();
  });
});
