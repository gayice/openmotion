import { MAX_PREVIEW_SCENE_FILES } from '../../../shared/preview-timing.ts';

// Reconcile the changed children after direct element updates decline. The runtime
// also owns the source from which these scenes will mount on subsequent seeks.
export const PREVIEW_SCENE_UPDATE = `
  const applyingScenes = new Map();
  let pendingSceneTextPick = null;

  function sceneInlineText(message) {
    if (message.phase === 'cancel' && pendingSceneTextPick === message.editId) pendingSceneTextPick = null;
    if (message.phase !== 'pick' || !applyingScenes.size || !Number.isFinite(message.x) || !Number.isFinite(message.y))
      return editInlineText(message);
    const hit = () => document.elementFromPoint(message.x * innerWidth, message.y * innerHeight)?.closest('[id],[data-hf-id]');
    const target = describe(hit()), swap = applyingScenes.get(target?.sourceFile);
    if (!swap) return editInlineText(message);
    pendingSceneTextPick = message.editId;
    return swap.ready.catch(() => false).then(applied => {
      if (pendingSceneTextPick !== message.editId) return null;
      pendingSceneTextPick = null;
      if (!applied || sourceVersions[swap.path] !== swap.version || applyingScenes.has(swap.path)) return null;
      const node = inspectorElement(target);
      return node && hit() === node ? editInlineText(message) : null;
    });
  }

  function sceneCanvasDrag(message) {
    if (message.phase === 'finish' && drag?.sceneUpdate && drag.id === message.gestureId)
      return finishSceneDrag(drag, message);
    const result = canvasDrag(message);
    if (message.phase === 'start' && drag?.id === message.gestureId) drag.sceneUpdate = applyingScenes.get(drag.selection.sourceFile);
    return result;
  }

  // A drag can start while the player awaits captions or new scene scripts.
  // Reuse the release delta only if the same layer has the same position basis.
  async function finishSceneDrag(gesture, message) {
    const applied = await gesture.sceneUpdate.ready.catch(() => false);
    if (drag !== gesture) return null;
    canvasDrag({phase:'cancel', gestureId:gesture.id});
    const {path, version} = gesture.sceneUpdate;
    if (!applied || sourceVersions[path] !== version || applyingScenes.has(path)) return null;
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

  function uniqueSceneHost(path, root = document) {
    const hosts = Array.from(root.querySelectorAll('[data-hf-scene][data-composition-file]'))
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
    return !!before && !!after && [...changed].every(key => Object.hasOwn(before, key) && Object.hasOwn(after, key)) &&
      Object.keys(before).length === Object.keys(after).length &&
      Object.keys(before).every(key => changed.has(key) || (Object.hasOwn(after, key) && before[key] === after[key]));
  }

  // One owner may update this document at a time, including while the runtime awaits captions.
  let sceneTail = Promise.resolve();
  const appliedSceneVersions = new Map();
  function refreshPeerScene(message) {
    const result = sceneTail.then(() => refreshSceneReceipts(message));
    sceneTail = result.catch(() => false);
    return result;
  }

  async function refreshSceneReceipts(message, previous) {
    const { expiresAt } = message;
    const receipts = message.fileVersions ?? { [message.path]: message.fileVersion };
    const paths = Object.keys(receipts);
    if (compositionPath !== 'index.html' || message.documentId !== styleDocumentId ||
        !paths.length || paths.length > ${MAX_PREVIEW_SCENE_FILES} ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now() || typeof window.__hfSwapScenes !== 'function') return false;
    const targets = [];
    for (const path of paths) {
      const host = uniqueSceneHost(path), base = sourceVersions[path];
      if (!host || !Object.hasOwn(sourceVersions, path) || !base || typeof receipts[path] !== 'string') return false;
      targets.push({ path, base, host, scene: host.getAttribute('data-hf-scene'), parked: host.hasAttribute('data-hf-parked-scene') });
    }
    const scenes = new Set(targets.map(target => target.scene));
    if (scenes.size !== paths.length || scenes.has(null) ||
        targets.some(a => targets.some(b => a !== b && a.host.contains(b.host)))) return false;
    const current = () => targets.every(({path, host, parked, base}) => uniqueSceneHost(path) === host &&
      host.hasAttribute('data-hf-parked-scene') === parked && sourceVersions[path] === base) &&
      !drag && !pendingDrags.size && !inlineText && Date.now() < expiresAt;
    if (!current()) return false;
    if (targets.every(({path,base}) => appliedSceneVersions.get(path) === base &&
        sourceIdentity(base).fileVersion === receipts[path])) return true;

    const signal = AbortSignal.timeout(Math.min(5000, expiresAt - Date.now()));
    const url = new URL(location.href);
    url.searchParams.delete('sceneFile');
    const requested = targets.filter(({path}) => !previous?.files.has(path));
    for (const {path} of requested) url.searchParams.append('sceneFile', path);
    const response = await fetch(url.href, { cache: 'no-cache', redirect: 'error', signal });
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('text/plain')) return false;
    let html = await response.text();
    const next = new DOMParser().parseFromString(html, 'text/html');
    // An older API may return only the first requested child during a rolling update.
    if (!requested.every(({path, scene}) => uniqueSceneHost(path, next)?.getAttribute('data-hf-scene') === scene)) return false;
    const bridges = next.querySelectorAll('script[data-openmotion-preview]');
    if (bridges.length !== 1) return false;
    const config = bridges[0].getAttribute('data-openmotion-preview');
    const incoming = JSON.parse(config);
    const versions = incoming?.sourceVersions;
    if (incoming?.projectId !== projectId || incoming.compositionPath !== compositionPath ||
        incoming.canRebindTiming !== settings.canRebindTiming || JSON.stringify(incoming.liveEdits) !== JSON.stringify(settings.liveEdits) ||
        JSON.stringify(incoming.htmlSources) !== JSON.stringify(settings.htmlSources) ||
        !versions || !paths.every(path => sourceIdentity(versions[path]).fileVersion === receipts[path])) return false;
    const oldParts = sceneParts(document), newParts = sceneParts(next);
    if (!oldParts || !newParts || oldParts.shared !== newParts.shared || !current()) return false;

    // A nearby write may already be present in this signed snapshot, even before
    // its separate SSE reaches the parent. Fetch the known independent scenes together once.
    const related = Object.keys(versions).filter(path => !Object.hasOwn(receipts, path) && sourceVersions[path] !== versions[path]);
    if (related.length) {
      if (previous || paths.length + related.length > ${MAX_PREVIEW_SCENE_FILES}) return false;
      const combined = {...receipts};
      for (const path of related) {
        const host = uniqueSceneHost(path);
        if (!sourceVersions[path] || path === compositionPath || !host) return false;
        combined[path] = sourceIdentity(versions[path]).fileVersion;
      }
      return refreshSceneReceipts({...message, fileVersions:combined}, {doc:next, files:new Set(paths), config, parts:newParts});
    }
    if (!sameOtherEntries(sourceVersions, versions, new Set(paths)) ||
        !sameOtherEntries(oldParts.scenes, newParts.scenes, scenes)) return false;

    if (previous) {
      // The sibling read must describe exactly the same compiled project. Reuse
      // the original scene body, which can be large, rather than requesting it twice.
      if (previous.config !== config || JSON.stringify(previous.parts) !== JSON.stringify(newParts)) return false;
      for (const element of Array.from(next.body.children)) {
        if (!element.hasAttribute('data-hf-scene-fonts')) previous.doc.body.append(previous.doc.importNode(element, true));
      }
      html = '<!doctype html>' + previous.doc.documentElement.outerHTML;
    }

    const confirm = () => {
      if (targets.some(({path, base}) => sourceVersions[path] !== base)) return false;
      for (const path of paths) {
        forgetScenePlacement(path);
        confirmCanvasVersion(path, versions[path]);
        appliedSceneVersions.set(path, versions[path]);
      }
      return true;
    };
    const changed = targets.filter(({scene}) => newParts.scenes[scene] !== oldParts.scenes[scene]);
    if (!changed.length) return confirm();
    if (applyingScenes.size) return false;
    const ready = window.__hfSwapScenes(html, signal).then(confirm);
    for (const {path} of changed) applyingScenes.set(path, {path, version:versions[path], ready});
    try { return await ready; } finally { applyingScenes.clear(); }
  }
`;
