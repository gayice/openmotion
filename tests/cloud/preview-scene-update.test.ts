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

function fixture() {
  const document = parseHTMLContent(`<html><head></head><body>${parked}</body></html>`);
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'hf-scene-parts');
  meta.setAttribute('content', JSON.stringify(parts('old intro')));
  document.head.append(meta);
  const settings = {projectId: 'p', compositionPath: 'index.html'};
  const fresh = { ...settings, sourceVersions: { ...oldVersions, [file]: after }};
  const nextParts = parts('new intro');
  const templ = () => `<html><head><meta name="hf-scene-parts" content='${JSON.stringify(nextParts)}'></head><body><script data-openmotion-preview='${JSON.stringify(fresh)}'></script></body></html>`;
  const counts = { reads: 0, swaps: 0, confirms: 0 };
  const request = { documentId: 'frame-1', path: file, fileVersion: version, expiresAt: Date.now() + 3000 };
  let duringRead = () => {};
  const requestedFiles: string[][] = [];
  const confirmed: Record<string, string> = {};
  const refresh = runInNewContext(PREVIEW_SOURCE_IDENTITY + PREVIEW_SCENE_UPDATE + '\nrefreshPeerScene;', {
    settings, compositionPath: 'index.html', styleDocumentId: 'frame-1', sourceVersions: { ...oldVersions }, projectId: 'p',
    document, location: {href: 'https://preview.example/current?pt=test'}, URL, AbortSignal,
    drag: null, pendingDrags: new Map(), inlineText: null,
    DOMParser: class { parseFromString(html: string) { return parseHTMLContent(html); } },
    fetch: async (url: string) => {
      const target = new URL(url);
      assert.equal(target.searchParams.get('pt'), 'test');
      requestedFiles.push(target.searchParams.getAll('sceneFile'));
      counts.reads++;
      duringRead();
      return new Response(templ());
    },
    window: { __hfSwapScenes: async (html: string) => { assert.equal(html, templ()); counts.swaps++; } },
    confirmCanvasVersion: (path: string, value: string) => { confirmed[path] = value; counts.confirms++; },
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
