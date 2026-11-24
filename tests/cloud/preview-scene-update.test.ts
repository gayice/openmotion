import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parseHTMLContent } from '@hyperframes/core/compiler';
import { PREVIEW_SOURCE_IDENTITY } from '../../src/studio/engine/preview-bridge.ts';
import { bundlePreviewInMemory } from '../../src/studio/engine/preview-bundler.ts';
import { PREVIEW_SCENE_UPDATE } from '../../src/studio/engine/preview-scene-update.ts';
import { previewSceneFragment } from '../../src/studio/engine/preview-scene-fragment.ts';
import { InMemoryVirtualProject } from '../../src/studio/virtual-project-store.ts';

const file = 'compositions/intro.html';
const other = 'compositions/outro.html';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const after = digest('new intro');
const version = `"sha256:${after}"`;
const oldVersions = { [file]: digest('old intro'), [other]: digest('outro') };
const parts = (intro: string) => ({ shared: 'same main', scenes: { intro, outro: 'same outro' } });
const parked = `<section data-composition-file="${file}" data-hf-scene="intro" data-hf-parked-scene></section>`;

it('keeps ordered scene scripts, styles and font declarations while omitting the shell and ambiguous instances', () => {
  const host = `<section data-composition-file="${file}" data-hf-scene="intro"><span>Title</span><script data-hf-scene="intro">inside()</script></section>`;
  const compile = (scenes: string) => `<html><head><meta name="hf-scene-parts" content="{}"><script data-openmotion-preview="{}" src="/bridge.js"></script>
    <style data-hf-scene-fonts>@font-face{font-family:Heading}</style><style data-hf-scene="intro">h1{color:red}</style>
    <script>unrelated()</script></head><body>${scenes}<script data-hf-scene="intro">after()</script></body></html>`;
  const html = previewSceneFragment(compile(host), [file])!;
  const fragment = parseHTMLContent(html);
  assert.equal(fragment.querySelector('[data-hf-scene-fonts]')?.textContent, '@font-face{font-family:Heading}');
  assert.equal(fragment.querySelector('style[data-hf-scene]')?.textContent, 'h1{color:red}');
  assert.deepEqual(Array.from(fragment.querySelectorAll('script[data-hf-scene]'), el => el.textContent), ['inside()', 'after()']);
  assert.ok(!html.includes('unrelated()') && !html.includes('/bridge.js'));
  assert.equal(previewSceneFragment(compile(host + host), [file]), null);
});

function fixture({ firstSceneOnly = false, contentType = 'text/plain' } = {}) {
  const document = parseHTMLContent(`<html><head></head><body>${parked}</body></html>`);
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'hf-scene-parts');
  meta.setAttribute('content', JSON.stringify(parts('old intro')));
  document.head.append(meta);
  const settings = {projectId: 'p', compositionPath: 'index.html'};
  const fresh = { ...settings, sourceVersions: { ...oldVersions, [file]: after }};
  const nextParts = parts('new intro');
  const templ = (files: string[]) => {
    const hosts = files.map(path => `<section data-composition-file="${path}" data-hf-scene="${path === file ? 'intro' : 'outro'}"></section>`);
    return `<html><head><meta name="hf-scene-parts" content='${JSON.stringify(nextParts)}'></head><body><script data-openmotion-preview='${JSON.stringify(fresh)}'></script>${hosts.join('')}</body></html>`;
  };
  const counts = { reads: 0, swaps: 0, confirms: 0 };
  const live: Record<string, string> = { ...oldVersions };
  const request = { documentId: 'frame-1', path: file, fileVersion: version, expiresAt: Date.now() + 3000 };
  let duringRead = () => {};
  const requestedFiles: string[][] = [];
  const confirmed: Record<string, string> = {};
  const refresh = runInNewContext(PREVIEW_SOURCE_IDENTITY + PREVIEW_SCENE_UPDATE + '\nrefreshPeerScene;', {
    settings, compositionPath: 'index.html', styleDocumentId: 'frame-1', sourceVersions: live, projectId: 'p',
    document, location: {href: 'https://preview.example/current?pt=test'}, URL, AbortSignal,
    drag: null, pendingDrags: new Map(), inlineText: null,
    DOMParser: class { parseFromString(html: string) { return parseHTMLContent(html); } },
    fetch: async (url: string) => {
      const target = new URL(url);
      assert.equal(target.searchParams.get('pt'), 'test');
      const files = target.searchParams.getAll('sceneFile');
      requestedFiles.push(files);
      counts.reads++;
      duringRead();
      return new Response(templ(firstSceneOnly ? files.slice(0, 1) : files), {headers: {'Content-Type': contentType}});
    },
    window: { __hfSwapScenes: async (html: string) => { assert.ok(html.includes('hf-scene-parts')); counts.swaps++; } },
    confirmCanvasVersion: (path: string, value: string) => { confirmed[path] = value; live[path] = value; counts.confirms++; },
  });
  return { document, counts, request, fresh, nextParts, requestedFiles, confirmed,
    run: (fileVersions?: Record<string, string>) => refresh(fileVersions ? {...request, fileVersions} : request), onRead: (fn: () => void) => {duringRead = fn;} };
}

it('updates the parked template through the runtime only after validating the fresh file and all other scenes', async () => {
  const f = fixture();
  assert.equal(await f.run(), true);
  assert.deepEqual(f.counts, {reads: 1, swaps: 1, confirms: 1});
});

it('requires every changed scene to have a matching receipt before the one runtime swap', async () => {
  for (const valid of [true, false]) {
    const f = fixture();
    const host = f.document.createElement('section');
    host.setAttribute('data-composition-file', other);
    host.setAttribute('data-hf-scene', 'outro');
    f.document.body.append(host);
    const second = digest('fresh outro');
    f.fresh.sourceVersions[other] = second;
    f.nextParts.scenes.outro = 'new outro';
    const versions = { [file]: version, [other]: valid ? `"sha256:${second}"` : '"stale"' };
    assert.equal(await f.run(versions), valid);
    assert.deepEqual(f.requestedFiles, [[file, other]]);
    assert.deepEqual(f.counts, {reads: 1, swaps: valid ? 1 : 0, confirms: valid ? 2 : 0});
    assert.deepEqual(f.confirmed, valid ? {[file]: after, [other]: second} : {});
  }
});

it('keeps the displayed document if an older API returns only one requested scene or the full page', async () => {
  for (const options of [{ firstSceneOnly: true }, { contentType: 'text/html' }]) {
    const f = fixture(options);
    const host = f.document.createElement('section');
    host.setAttribute('data-composition-file', other);
    host.setAttribute('data-hf-scene', 'outro');
    f.document.body.append(host);
    const second = digest('fresh outro');
    f.fresh.sourceVersions[other] = second;
    f.nextParts.scenes.outro = 'new outro';
    assert.equal(await f.run({[file]: version, [other]: `"sha256:${second}"`}), false);
    assert.deepEqual(f.counts, {reads: 1, swaps: 0, confirms: 0});
  }
});

it('catches up a second independent saved file before its SSE and skips its already-applied receipt', async () => {
  const f = fixture();
  const host = f.document.createElement('section');
  host.setAttribute('data-composition-file', other);
  host.setAttribute('data-hf-scene', 'outro');
  f.document.body.append(host);
  const newer = digest('next outro');
  f.fresh.sourceVersions[other] = newer;
  f.nextParts.scenes.outro = 'new outro';
  assert.deepEqual(await Promise.all([f.run(), f.run({[other]: `"sha256:${newer}"`})]), [true, true]);
  assert.deepEqual(f.requestedFiles, [[file], [other]]);
  assert.deepEqual(f.counts, {reads: 2, swaps: 1, confirms: 2});
});

it('does not apply a partial or shifted snapshot if the sibling changes again while fetching the batch', async () => {
  const f = fixture();
  const host = f.document.createElement('section');
  host.setAttribute('data-composition-file', other);
  host.setAttribute('data-hf-scene', 'outro');
  f.document.body.append(host);
  f.fresh.sourceVersions[other] = digest('second outro');
  f.nextParts.scenes.outro = 'changed';
  f.onRead(() => { if (f.counts.reads === 2) f.fresh.sourceVersions[other] = digest('third outro'); });
  assert.equal(await f.run(), false);
  assert.deepEqual(f.counts, {reads: 2, swaps: 0, confirms: 0});
});

it('uses the runtime to update both a mounted scene and its next mount', async () => {
  const f = fixture();
  f.document.querySelector('section')!.removeAttribute('data-hf-parked-scene');
  assert.equal(await f.run(), true);
  assert.deepEqual(f.counts, {reads: 1, swaps: 1, confirms: 1});
});

it('does not swap missing, repeated or remounting targets', async () => {
  for (const state of ['missing', 'duplicate', 'remounting', 'mount-state-changed']) {
    const f = fixture();
    const host = f.document.querySelector('section')!;
    if (state === 'mount-state-changed') f.onRead(() => host.removeAttribute('data-hf-parked-scene'));
    if (state === 'missing') host.remove();
    if (state === 'duplicate') host.after(host.cloneNode(true));
    if (state === 'remounting') f.onRead(() => host.replaceWith(host.cloneNode(true)));
    assert.equal(await f.run(), false, state);
    assert.deepEqual(f.counts, {reads: ['remounting', 'mount-state-changed'].includes(state) ? 1 : 0, swaps: 0, confirms: 0});
  }
});

it('refuses a stale revision, a changed shared shell, or another changed scene or HTML file', async () => {
  for (const conflict of ['revision', 'shell', 'scene', 'file']) {
    const f = fixture();
    if (conflict === 'revision') f.request.fileVersion = '"stale"';
    if (conflict === 'shell') f.nextParts.shared = 'new shell';
    if (conflict === 'scene') f.nextParts.scenes.outro = 'new outro';
    if (conflict === 'file') f.fresh.sourceVersions[other] = digest('new outro');
    assert.equal(await f.run(), false, conflict);
    assert.deepEqual(f.counts, {reads: 1, swaps: 0, confirms: 0});
  }
});

it('keeps the shared film fingerprint independent of a child file receipt but sensitive to authored shared changes', async () => {
  async function render(text: string, heading: string) {
    const index = `<html><body><div data-composition-id="main" data-duration="3"><h1>${heading}</h1><div data-composition-id="intro" data-composition-src="${file}" data-duration="3"></div></div></body></html>`;
    const scene = `<html><body><div data-composition-id="intro" data-duration="3"><p>${text}</p></div></body></html>`;
    const textContents = { 'index.html': index, [file]: scene };
    const project = new InMemoryVirtualProject({projectId: 'p', projectName: 'test', revision: digest(scene + index), textContents,
      files: Object.entries(textContents).map(([path, html]) => ({path, sha256: digest(html), blobScope:'workspace',
        sizeBytes: Buffer.byteLength(html), mimeType: 'text/html', isText: true, updatedAt: new Date()}))});
    const html = await bundlePreviewInMemory(project, {bridgeOrigin:'https://preview.test', baseHref:'https://preview.test/api/projects/p/preview/~assets/variant/', skipDeterministicFonts:true});
    const doc = parseHTMLContent(html!);
    return JSON.parse(doc.querySelector('meta[name="hf-scene-parts"]')!.getAttribute('content')!);
  }
  const before = await render('old intro', 'same title');
  const after = await render('new intro', 'same title');
  assert.equal(before.shared, after.shared);
  assert.notDeepEqual(before.scenes, after.scenes);
  assert.notEqual((await render('new intro', 'new title')).shared, after.shared);
});

it('retains only confirmed placement across real park/remount pairs and releases it on undo or replacement', () => {
  const document = parseHTMLContent('<html><body><main></main></body></html>');
  const root = document.querySelector('main')!;
  const sourceVersions = { [file]: 'a' };
  const pending: { confirmedVersion: string }[] = [];
  let disconnected = 0;
  let notify!: (records: { addedNodes: Element[]; removedNodes: Element[] }[]) => void;
  class Observer {
    constructor(callback: typeof notify) { notify = callback; }
    observe() {}
    disconnect() { disconnected++; }
  }
  const tracker = runInNewContext(PREVIEW_SCENE_UPDATE + '\n({rememberScenePlacement, advanceScenePlacements, forgetScenePlacement})', {
    window: { __hfParkedSceneMarkup() {} }, document, sourceVersions, pendingForSource: () => pending,
    MutationObserver: Observer, sourceFileForElement: () => file,
  });
  const makeHost = (left: string) => {
    const host = document.createElement('section');
    host.setAttribute('data-hf-scene', 'intro');
    host.setAttribute('data-composition-file', file);
    host.innerHTML = '<h1 id="title">Title</h1>';
    const node = host.querySelector('h1')!;
    node.style.left = left;
    return { host, node };
  };
  let active = makeHost('10px');
  root.append(active.host);
  const move = (before: string, after: string, from: string, to: string) => {
    tracker.advanceScenePlacements(file, before, after);
    tracker.rememberScenePlacement(active.node, file, '#title', { tag: 'h1', styles: [['left', from, to]] }, after);
    sourceVersions[file] = after;
  };
  const mount = (left: string, parked = true, scene = 'intro', source = file) => {
    const previous = document.createElement('section');
    previous.setAttribute('data-hf-scene', scene);
    if (parked) previous.setAttribute('data-hf-parked-scene', '');
    const latest = makeHost(left);
    latest.host.setAttribute('data-hf-scene', scene);
    latest.host.setAttribute('data-composition-file', source);
    root.replaceChildren(latest.host);
    active = latest;
    notify([{ removedNodes: [previous], addedNodes: [latest.host] }]);
    return latest.node.style.left;
  };
  move('a', 'b', '10px', '30px');
  move('b', 'c', '30px', '45px');
  assert.equal(mount('10px'), '45px');
  assert.equal(mount('10px'), '45px');
  assert.equal(mount('10px', true, 'second-instance'), '45px');
  assert.equal(mount('10px', true, 'unrelated', other), '10px');
  assert.equal(mount('12px'), '12px');
  // A replacement of a live host, even with the same file and element id, is not an unpark.
  assert.equal(mount('10px', false), '10px');
  sourceVersions[file] = 'another-version';
  assert.equal(mount('10px'), '10px');
  sourceVersions[file] = '';
  pending.push({ confirmedVersion: 'c' });
  assert.equal(mount('10px'), '45px');
  // Remote undo back to the source template drops the last override and its observer.
  move('c', 'd', '45px', '10px');
  assert.equal(disconnected, 1);
  assert.equal(mount('10px'), '10px');
  move('d', 'e', '10px', '55px');
  // A new template owns every node in its scene, including reused element ids.
  tracker.forgetScenePlacement(file);
  assert.equal(disconnected, 2);
  assert.equal(mount('10px'), '10px');
});
