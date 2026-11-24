// Reconcile one compiled child after direct element updates decline. The runtime
// also owns the source from which this scene will mount on subsequent seeks.
export const PREVIEW_SCENE_UPDATE = `
  function uniqueSceneHost(path) {
    const hosts = Array.from(document.querySelectorAll('[data-hf-scene][data-composition-file]'))
      .filter(el => el.getAttribute('data-composition-file') === path);
    return hosts.length === 1 ? hosts[0] : null;
  }

  function sceneParts(doc) {
    return JSON.parse(doc.querySelector('meta[name="hf-scene-parts"]')?.getAttribute('content') || 'null');
  }

  function sameOtherEntries(before, after, changed) {
    return !!before && !!after && Object.hasOwn(before, changed) && Object.hasOwn(after, changed) &&
      Object.keys(before).length === Object.keys(after).length &&
      Object.keys(before).every(key => key === changed || before[key] === after[key]);
  }

  async function refreshPeerScene(message) {
    const { path, fileVersion: version, expiresAt } = message;
    if (compositionPath !== 'index.html' || message.documentId !== styleDocumentId ||
        typeof path !== 'string' || !Object.hasOwn(sourceVersions, path) || typeof version !== 'string' ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now() || typeof window.__hfSwapScenes !== 'function') return false;
    const host = uniqueSceneHost(path), base = sourceVersions[path];
    if (!host || !base) return false;
    const scene = host.getAttribute('data-hf-scene');
    const parked = host.hasAttribute('data-hf-parked-scene');
    const current = () => uniqueSceneHost(path) === host && host.hasAttribute('data-hf-parked-scene') === parked && sourceVersions[path] === base &&
      !drag && !pendingDrags.size && !inlineText && Date.now() < expiresAt;
    if (!current()) return false;

    const signal = AbortSignal.timeout(Math.min(5000, expiresAt - Date.now()));
    const response = await fetch(location.href, { cache: 'no-cache', redirect: 'error', signal });
    if (!response.ok) return false;
    const html = await response.text();
    const next = new DOMParser().parseFromString(html, 'text/html');
    const bridges = next.querySelectorAll('script[data-openmotion-preview]');
    if (bridges.length !== 1) return false;
    const incoming = JSON.parse(bridges[0].getAttribute('data-openmotion-preview'));
    const versions = incoming?.sourceVersions;
    if (incoming?.projectId !== projectId || incoming.compositionPath !== compositionPath ||
        incoming.canRebindTiming !== settings.canRebindTiming || JSON.stringify(incoming.liveEdits) !== JSON.stringify(settings.liveEdits) ||
        JSON.stringify(incoming.htmlSources) !== JSON.stringify(settings.htmlSources) ||
        !sameOtherEntries(sourceVersions, versions, path) || sourceIdentity(versions[path]).fileVersion !== version) return false;
    const oldParts = sceneParts(document), newParts = sceneParts(next);
    if (!oldParts || !newParts || oldParts.shared !== newParts.shared ||
        !sameOtherEntries(oldParts.scenes, newParts.scenes, scene) || !current()) return false;

    if (newParts.scenes[scene] !== oldParts.scenes[scene]) await window.__hfSwapScenes(html, signal);
    if (sourceVersions[path] !== base) return false;
    confirmCanvasVersion(path, versions[path]);
    return true;
  }
`;
