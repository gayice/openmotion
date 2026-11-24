// Reconcile one compiled child after direct element updates decline. The runtime
// also owns the source from which this scene will mount on subsequent seeks.
export const PREVIEW_SCENE_UPDATE = `
  let applyingScene = null;
  let pendingSceneTextPick = null;

  function sceneInlineText(message) {
    if (message.phase === 'cancel' && pendingSceneTextPick === message.editId) pendingSceneTextPick = null;
    if (message.phase !== 'pick' || !applyingScene || !Number.isFinite(message.x) || !Number.isFinite(message.y))
      return editInlineText(message);
    const hit = () => document.elementFromPoint(message.x * innerWidth, message.y * innerHeight)?.closest('[id],[data-hf-id]');
    const target = describe(hit()), swap = applyingScene;
    if (target?.sourceFile !== swap.path) return editInlineText(message);
    pendingSceneTextPick = message.editId;
    return swap.ready.catch(() => false).then(applied => {
      if (pendingSceneTextPick !== message.editId) return null;
      pendingSceneTextPick = null;
      if (!applied || sourceVersions[swap.path] !== swap.version || applyingScene?.path === swap.path) return null;
      const node = inspectorElement(target);
      return node && hit() === node ? editInlineText(message) : null;
    });
  }

  function sceneCanvasDrag(message) {
    if (message.phase === 'finish' && drag?.sceneUpdate && drag.id === message.gestureId)
      return finishSceneDrag(drag, message);
    const result = canvasDrag(message);
    if (message.phase === 'start' && drag?.id === message.gestureId && applyingScene?.path === drag.selection.sourceFile)
      drag.sceneUpdate = applyingScene;
    return result;
  }

  // A drag can start while the player awaits captions or new scene scripts.
  // Reuse the release delta only if the same layer has the same position basis.
  async function finishSceneDrag(gesture, message) {
    const applied = await gesture.sceneUpdate.ready.catch(() => false);
    if (drag !== gesture) return null;
    canvasDrag({phase:'cancel', gestureId:gesture.id});
    const {path, version} = gesture.sceneUpdate;
    if (!applied || sourceVersions[path] !== version || applyingScene?.path === path) return null;
    const target = inspectorElement(gesture.selection);
    if (!target || target.localName !== gesture.element.localName) return null;
    startDrag({gestureId:gesture.id, corner:gesture.corner}, target);
    if (!drag) return null;
    const same = drag.left === gesture.left && drag.top === gesture.top && drag.makeRelative === gesture.makeRelative &&
      ['x','y'].every(key => drag.selection.geometry[key] === gesture.selection.geometry[key]) &&
      (!gesture.corner || (drag.width === gesture.width && drag.height === gesture.height)) &&
      ['a','b','c','d'].every(key => drag.axes[key] === gesture.axes[key]) &&
      ['time','x','y'].every(key => drag.startPosition[key] === gesture.startPosition[key]);
    if (!same) { drag = null; return null; }
    return canvasDrag(message);
  }

  function uniqueSceneHost(path) {
    const hosts = Array.from(document.querySelectorAll('[data-hf-scene][data-composition-file]'))
      .filter(el => el.getAttribute('data-composition-file') === path);
    return hosts.length === 1 ? hosts[0] : null;
  }

  // The runtime keeps the compiled HTML in a private cache and replaces the scene host
  // when parking or remounting it. Reapply only confirmed position deltas to a fresh host.
  const scenePlacements = new Map();
  let placementObserver;
  function forgetScenePlacement(path) {
    scenePlacements.delete(path);
    if (!scenePlacements.size) placementObserver?.disconnect();
  }
  function advanceScenePlacements(path, before, after) {
    const file = scenePlacements.get(path);
    if (!file) return;
    if (file.version === before) file.version = after;
    else forgetScenePlacement(path);
  }
  function restoreScenePlacements(records) {
    for (const record of records) for (const host of record.addedNodes) {
      if (host.nodeType !== 1 || host.hasAttribute('data-hf-parked-scene')) continue;
      const scene = host.getAttribute('data-hf-scene');
      if (!scene || !Array.from(record.removedNodes).some(old =>
        old.nodeType === 1 && old.hasAttribute('data-hf-parked-scene') && old.getAttribute('data-hf-scene') === scene)) continue;
      const paths = new Set([host, ...host.querySelectorAll('[data-composition-file],[data-composition-src]')]
        .map(el => el.getAttribute('data-composition-file') || el.getAttribute('data-composition-src')));
      for (const path of paths) {
        const file = scenePlacements.get(path);
        if (!file) continue;
        const pending = !sourceVersions[path] && pendingForSource(path)[0];
        if ((sourceVersions[path] || pending?.confirmedVersion || pending?.sha256) !== file.version) continue;
        for (const [selector, {tag, styles}] of file.targets) {
          const nodes = Array.from(host.querySelectorAll(selector)).filter(node =>
            node.localName === tag && sourceFileForElement(node) === path);
          for (const node of nodes) for (const [name, [from, to]] of styles) {
            const style = node.style;
            if (style.getPropertyValue(name) !== from || (typeof style.getPropertyPriority === 'function' && style.getPropertyPriority(name))) continue;
            if (to) style.setProperty(name, to);
            else style.removeProperty(name);
          }
        }
      }
    }
  }
  function rememberScenePlacement(node, path, selector, change, version) {
    if (typeof window.__hfParkedSceneMarkup !== 'function' || !node.parentElement?.closest('[data-hf-scene]')) return;
    if (!scenePlacements.size) {
      placementObserver ??= new MutationObserver(restoreScenePlacements);
      for (const host of document.querySelectorAll('[data-hf-scene][data-composition-file]')) {
        if (host.parentElement && !host.parentElement.closest('[data-hf-scene]')) placementObserver.observe(host.parentElement, {childList:true});
      }
    }
    const file = scenePlacements.get(path) || {version, targets:new Map()};
    const target = file.targets.get(selector) || {tag:change.tag, styles:new Map()};
    for (const [name, from, to] of change.styles) {
      const first = target.styles.get(name)?.[0] ?? from;
      if (first === to) target.styles.delete(name);
      else target.styles.set(name, [first, to]);
    }
    if (target.styles.size) file.targets.set(selector, target);
    else file.targets.delete(selector);
    if (file.targets.size) scenePlacements.set(path, file);
    else forgetScenePlacement(path);
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

    const confirm = () => {
      if (sourceVersions[path] !== base) return false;
      forgetScenePlacement(path);
      confirmCanvasVersion(path, versions[path]);
      return true;
    };
    if (newParts.scenes[scene] === oldParts.scenes[scene]) return confirm();
    if (applyingScene) return false;
    const swap = {path, version:versions[path], ready:window.__hfSwapScenes(html, signal).then(confirm)};
    applyingScene = swap;
    try { return await swap.ready; } finally { applyingScene = null; }
  }
`;
