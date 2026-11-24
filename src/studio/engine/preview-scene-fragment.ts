import { parseHTMLContent } from '@hyperframes/core/compiler';

/** The runtime swaps the requested scenes, but compares the fingerprints of the entire compiled film first. */
export function previewSceneFragment(compiled: string, files: readonly string[]): string | null {
  const doc = parseHTMLContent(compiled);
  const hosts = Array.from(doc.querySelectorAll('[data-hf-scene][data-composition-file]'))
    .filter(el => files.includes(el.getAttribute('data-composition-file')!));
  const scenes = new Set(hosts.map(el => el.getAttribute('data-hf-scene')));
  if (hosts.length !== files.length || scenes.size !== files.length || scenes.has(null) ||
      new Set(hosts.map(el => el.getAttribute('data-composition-file'))).size !== files.length ||
      hosts.some(host => hosts.some(other => other !== host && other.contains(host)))) return null;
  const manifest = doc.querySelector('meta[name="hf-scene-parts"]');
  const settings = doc.querySelector('script[data-openmotion-preview]')?.getAttribute('data-openmotion-preview');
  if (!manifest || !settings) return null;

  // A data-only copy of the bridge settings lets the recipient verify all source
  // versions. Only the requested scenes' authored scripts belong in the swap payload.
  const config = doc.createElement('script');
  config.type = 'application/json';
  config.setAttribute('data-openmotion-preview', settings);
  const parts = Array.from(doc.querySelectorAll('[data-hf-scene],style[data-hf-scene-fonts]'))
    .filter(el => scenes.has(el.getAttribute('data-hf-scene')) || el.hasAttribute('data-hf-scene-fonts'))
    .filter(el => !hosts.some(host => host !== el && host.contains(el)));
  return `<!doctype html><html><head>${manifest.outerHTML}${config.outerHTML}</head><body>${parts.map(el => el.outerHTML).join('')}</body></html>`;
}
