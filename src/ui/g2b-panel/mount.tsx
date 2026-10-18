import { createRoot, type Root } from 'react-dom/client';
import type { PanelController } from './controller';
import { PanelApp } from './Panel';

export function mountPanel(container: HTMLElement, controller: PanelController): Root {
  const root = createRoot(container);
  root.render(<PanelApp controller={controller} />);
  return root;
}
