import { MASCOT_CSS, mascotFile, mascotSrc, type MascotMood, type MascotVariant } from './assets';

/** root 안에 마스코트 CSS를 한 번만 넣는다. Document면 head, ShadowRoot면 그 안 */
export function ensureMascotStyle(root: Document | ShadowRoot): void {
  if (root.querySelector('style[data-bidmate-mascot]')) return;
  const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument!;
  const style = doc.createElement('style');
  style.setAttribute('data-bidmate-mascot', '');
  style.textContent = MASCOT_CSS;
  const parent = root.nodeType === 9 ? ((root as Document).head ?? (root as Document).documentElement) : root;
  parent.appendChild(style);
}

export function createMascotImg(
  doc: Document,
  o: { mood?: MascotMood; variant?: MascotVariant; size: number },
): HTMLImageElement {
  const mood = o.mood ?? 'idle';
  const variant = o.variant ?? 'full';
  const img = doc.createElement('img');
  img.className = 'bm-mascot';
  img.dataset.mood = mood;
  img.dataset.variant = variant;
  img.width = o.size;
  img.height = o.size;
  img.alt = '';
  img.draggable = false;
  img.setAttribute('aria-hidden', 'true');
  img.src = mascotSrc(mood, variant);
  img.addEventListener('error', () => { img.hidden = true; });
  return img;
}

export function setMascotMood(img: HTMLImageElement, mood: MascotMood): void {
  const variant: MascotVariant = img.dataset.variant === 'face' ? 'face' : 'full';
  const prevMood = img.dataset.mood as MascotMood | undefined;
  img.dataset.mood = mood;
  if (!prevMood || mascotFile(prevMood, variant) !== mascotFile(mood, variant)) {
    img.src = mascotSrc(mood, variant);
  }
}
