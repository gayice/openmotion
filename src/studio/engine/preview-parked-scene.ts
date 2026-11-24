// The player owns the markup and scripts from which a parked scene will mount.
// A DOM edit to the empty placeholder would be lost on the next seek.
export const PREVIEW_PARKED_SCENE = `
  function parkedHost(path) {
    const hosts = Array.from(document.querySelectorAll('[data-hf-scene][data-composition-file]'))
      .filter(el => el.getAttribute('data-composition-file') === path);
    return hosts.length === 1 && hosts[0].hasAttribute('data-hf-parked-scene') ? hosts[0] : null;
  }

  // The runtime keeps the compiled HTML in a private cache and replaces the scene host
  // when parking or remounting it. Reapply only confirmed position deltas to a fresh host.
  const scenePlacements = new Map();
  let placementObserver;
  function advanceScenePlacements(path, before, after) {
    for (const [scene, placements] of scenePlacements) {
      for (const [key, target] of placements) {
        if (target.path !== path) continue;
        if (target.version === before) target.version = after;
        else placements.delete(key);
      }
      if (!placements.size) forgetScenePlacement(scene);
    }
  }
  function forgetScenePlacement(scene) {
    scenePlacements.delete(scene);
    if (!scenePlacements.size) placementObserver?.disconnect();
  }
  function restoreScenePlacements(records) {
    for (const record of records) for (const host of record.addedNodes) {
      if (host.nodeType !== 1 || host.hasAttribute('data-hf-parked-scene')) continue;
      const scene = host.getAttribute('data-hf-scene'), placements = scenePlacements.get(scene);
      if (!placements || !Array.from(record.removedNodes).some(old =>
        old.nodeType === 1 && old.hasAttribute('data-hf-parked-scene') && old.getAttribute('data-hf-scene') === scene)) continue;
      for (const {path, selector, tag, styles, version} of placements.values()) {
        const pending = !sourceVersions[path] && pendingForSource(path)[0];
        if ((sourceVersions[path] || pending?.confirmedVersion || pending?.sha256) !== version) continue;
        const nodes = Array.from(host.querySelectorAll(selector)).filter(node =>
          node.localName === tag && sourceFileForElement(node) === path);
        if (nodes.length !== 1) continue;
        const style = nodes[0].style;
        for (const [name, [from, to]] of styles) {
          if (style.getPropertyValue(name) !== from || (typeof style.getPropertyPriority === 'function' && style.getPropertyPriority(name))) continue;
          if (to) style.setProperty(name, to);
          else style.removeProperty(name);
        }
      }
    }
  }
  function rememberScenePlacement(node, path, selector, change, version) {
    if (typeof window.__hfParkedSceneMarkup !== 'function') return;
    let host = node.closest('[data-hf-scene]');
    if (!host) return;
    for (let outer; (outer = host.parentElement?.closest('[data-hf-scene]'));) host = outer;
    if (node === host || !host.parentElement) return;
    const scene = host.getAttribute('data-hf-scene');
    let placements = scenePlacements.get(scene);
    if (!placements) {
      placements = new Map();
      scenePlacements.set(scene, placements);
      placementObserver ??= new MutationObserver(restoreScenePlacements);
      placementObserver.observe(host.parentElement, {childList:true});
    }
    const key = JSON.stringify([path, selector]);
    const target = placements.get(key) || {path, selector, tag:change.tag, version, styles:new Map()};
    for (const [name, from, to] of change.styles) {
      const first = target.styles.get(name)?.[0] ?? from;
      if (first === to) target.styles.delete(name);
      else target.styles.set(name, [first, to]);
    }
    if (target.styles.size) placements.set(key, target);
    else placements.delete(key);
    if (!placements.size) forgetScenePlacement(scene);
  }

  function sceneParts(doc) {
    return JSON.parse(doc.querySelector('meta[name="hf-scene-parts"]')?.getAttribute('content') || 'null');
  }

  function sameOtherEntries(before, after, changed) {
    return !!before && !!after && Object.hasOwn(before, changed) && Object.hasOwn(after, changed) &&
      Object.keys(before).length === Object.keys(after).length &&
      Object.keys(before).every(key => key === changed || before[key] === after[key]);
  }

  async function refreshParkedScene(message) {
    const { path, fileVersion: version, expiresAt } = message;
    if (compositionPath !== 'index.html' || message.documentId !== styleDocumentId ||
        typeof path !== 'string' || !Object.hasOwn(sourceVersions, path) || typeof version !== 'string' ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now() || typeof window.__hfSwapScenes !== 'function') return false;
    const host = parkedHost(path), base = sourceVersions[path];
    if (!host || !base) return false;
    const scene = host.getAttribute('data-hf-scene');
    const current = () => parkedHost(path) === host && sourceVersions[path] === base &&
      !drag && !pendingDrags.size && !inlineText && Date.now() < expiresAt;
    if (!current()) return false;

    const signal = AbortSignal.timeout(Math.min(5000, expiresAt - Date.now()));
    const url = new URL(location.href);
    url.searchParams.set('sceneFile', path);
    const response = await fetch(url.href, { cache: 'no-cache', redirect: 'error', signal });
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
    forgetScenePlacement(scene);
    confirmCanvasVersion(path, versions[path]);
    return true;
  }
`;
