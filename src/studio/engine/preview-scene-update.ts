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
