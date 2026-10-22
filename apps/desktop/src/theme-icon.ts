import { invoke } from '@tauri-apps/api/core';

type IconTheme = 'light' | 'dark';

// applyAppearance resolves 'system' and writes data-theme in every window, so
// observing the attribute covers settings changes and OS theme switches alike.
export function syncThemeIcon() {
  const root = document.documentElement;
  let sent: IconTheme | null = null;
  const update = () => {
    const theme: IconTheme = root.dataset.theme === 'light' ? 'light' : 'dark';
    if (theme === sent) return;
    sent = theme;
    invoke('app_set_icon_theme', { theme }).catch(() => {
      sent = null;
    });
  };
  update();
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}
