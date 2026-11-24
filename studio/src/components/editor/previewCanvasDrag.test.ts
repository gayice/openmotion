// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import { PREVIEW_SOURCE_IDENTITY } from "../../../../src/studio/engine/preview-bridge";
import { PREVIEW_CANVAS_DRAG } from "../../../../src/studio/engine/preview-canvas-drag";
import { PREVIEW_SCENE_UPDATE } from "../../../../src/studio/engine/preview-scene-update";

const originalHash = "a".repeat(64);

function createScene(declarative = false, position = false, tag = "div") {
  const makeElement = (id: string) => {
    const element = document.createElement(tag);
    element.id = id;
    document.body.append(element);
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() =>
      new DOMRect(parseFloat(element.style.left) || 0, parseFloat(element.style.top) || 0, parseFloat(element.style.width) || 20, parseFloat(element.style.height) || 10));
    return element;
  };
  const elements = ["one", "two"].map(makeElement);
  vi.spyOn(document, "elementFromPoint").mockImplementation(x => elements[x < 50 ? 0 : 1]!);
  // Execute the exact child-frame script with deterministic layout measurements.
  const { dispatch, swap, inline } = new Function("document", "getComputedStyle", "HTMLElement", "sourceVersions", "describe",
    "innerWidth", "innerHeight", "picked", "timingDocumentId", "compositionPath", "settings", "notifyInspectorSourceReady", "inspectorElement",
    PREVIEW_SOURCE_IDENTITY + PREVIEW_CANVAS_DRAG + PREVIEW_SCENE_UPDATE + `
    function editInlineText(message) { return message.phase === 'pick' ? sourceVersions['one.html'] : null; }
    return {dispatch:sceneCanvasDrag, inline:sceneInlineText, swap(path, version, ready, extra = {}) {
      const entries = Object.entries({...extra, [path]: version});
      const settled = ready.then(() => {
        for (const [file, next] of entries) confirmCanvasVersion(file,next);
        applyingScenes.clear();
        return true;
      });
      for (const [file, next] of entries) applyingScenes.set(file, {path:file, version:next, ready:settled});
    }};`)(
    document, (el: HTMLElement) => ({ position: el.style.position || "static", visibility: el.style.visibility, left: el.style.left, top: el.style.top, width: "20px", height: "10px", transform: "none", display: el.style.display || "block" }),
    HTMLElement, { "one.html": originalHash, "two.html": originalHash },
    (el: HTMLElement) => ({ sourceFile: el.id + ".html", elementId: el.id, geometry: el.getBoundingClientRect(),
      viewport: { width: 100, height: 100 } }), 100, 100, elements[0], declarative ? "frame" : undefined, "one.html", {liveEdits: {position}}, vi.fn(),
    ({elementId}: {elementId: string}) => document.getElementById(elementId),
  );
  return { one: elements[0]!, two: elements[1]!, swap, makeElement, inline,
    gesture: (phase: string, gestureId: string, fields: Record<string, unknown> = {}) =>
      dispatch({ phase, gestureId, x: 0, y: 0, dx: 0.25, dy: 0.5, ...fields }) };
}

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it("moves immediately across pending saves and rolls back dependent measurements together", () => {
  const {one, gesture} = createScene(true);
  gesture("start", "first");
  gesture("finish", "first");
  expect(gesture("start", "second")).toBeTruthy();
  expect(gesture("finish", "second")).toMatchObject({ predecessor: "first", left: 50 });
  expect(gesture("start", "third")).toBeTruthy();
  gesture("move", "third");
  expect(one.style.left).toBe("75px");
  gesture("cancel", "first");
  expect(one.style.left).toBe("");
  expect(gesture("finish", "third")).toBeNull();
  expect(gesture("start", "retry")).toBeTruthy();
});

it.each(["text", "position", "deleted", "cancelled"])("settles a drag during a scene swap with a concurrent %s change", async change => {
  const {one, swap, gesture, makeElement} = createScene();
  one.style.position = "absolute";
  one.style.left = "80px";
  const version = "b".repeat(64);
  const {promise, resolve} = Promise.withResolvers<void>();
  swap("one.html", version, promise, {"two.html": "c".repeat(64)});
  expect(gesture("start", "active")).toBeTruthy();
  gesture("move", "active");
  expect(one.style.left).toBe("105px");
  const result = gesture("finish", "active");
  if (change === "cancelled") gesture("cancel", "active");
  one.remove();
  const next = makeElement(change === "deleted" ? "new" : "one");
  next.style.position = "absolute";
  next.style.left = change === "position" ? "180px" : "80px";
  next.textContent = "New title";
  resolve();
  if (change === "text") {
    expect(await result).toMatchObject({elementId:"one", left:105, sha256:version});
    expect(next.style.left).toBe("105px");
  } else {
    expect(await result).toBeNull();
    expect(next.style.left).toBe(change === "position" ? "180px" : "80px");
  }
  expect(next.textContent).toBe("New title");
});

it.each(["same layer", "other layer", "cancelled"])("opens the inline caret after the swap only on the original hit (%s)", async state => {
  const {one, two, swap, inline, makeElement} = createScene();
  const version = "b".repeat(64);
  const {promise, resolve} = Promise.withResolvers<void>();
  swap("one.html", version, promise, {"two.html": "c".repeat(64)});
  const message = {phase:"pick", editId:"text", x:0, y:0};
  const result = inline(message);
  if (state === "cancelled") inline({...message, phase:"cancel"});
  one.remove();
  const next = makeElement("one");
  vi.mocked(document.elementFromPoint).mockReturnValue(state === "other layer" ? two : next);
  resolve();
  expect(await result).toBe(state === "same layer" ? version : null);
});

it("chains certified nested moves without requiring the active root", () => {
  const { two, gesture } = createScene(false, true);
  two.style.position = "absolute";
  expect(gesture("start", "first", { x: 1 })).toBeTruthy();
  gesture("finish", "first");
  expect(gesture("start", "second", { x: 1 })).toBeTruthy();
  expect(gesture("finish", "second")).toMatchObject({ predecessor: "first", left: 50 });
  gesture("cancel", "first");
  expect(two.style.left).toBe("");
});

it("holds the released layer, allows an unrelated source to move, and waits for a fresh digest on the saved source", () => {
  const { one, two, gesture } = createScene();
  expect(gesture("start", "first")).toBeTruthy();
  expect(gesture("finish", "first")).toMatchObject({ sourceFile: "one.html", sha256: originalHash, left: 25, top: 50 });
  expect(one.style.left).toBe("25px");
  expect(gesture("start", "same-source")).toEqual({ waitingForSource: true });
  expect(gesture("start", "second", { x: 1 })).toBeTruthy();
  gesture("move", "second");
  gesture("commit", "first", { changed: true });
  gesture("cancel", "first");
  expect(one.style.left).toBe("25px");
  expect(two.style.left).toBe("25px");
  gesture("cancel", "second");
  expect(two.style.left).toBe("");
  expect(gesture("start", "stale-source")).toEqual({ waitingForSource: true });
});

it("captures the playhead and final local translation once at gesture completion", () => {
  vi.stubGlobal("__player", {getTime: () => 2});
  vi.stubGlobal("gsap", {getProperty: (_: Element, axis: string) => axis === "x" ? 5 : 10});
  try {
    const {gesture} = createScene();
    gesture("start", "animated");
    expect(gesture("move", "animated")).toBeNull();
    expect(gesture("finish", "animated")).toMatchObject({position:{time:2, x:30, y:60}});
  } finally {
    vi.unstubAllGlobals();
  }
});

it("rolls back only properties still owned by the failed gesture and permits a retry", () => {
  const { one, gesture } = createScene();
  one.style.setProperty("top", "4px", "important");
  one.style.position = "absolute";
  gesture("start", "first");
  gesture("finish", "first");
  one.style.left = "100px";
  gesture("cancel", "first");
  expect(one.style.left).toBe("100px");
  expect(one.style.top).toBe("4px");
  expect(one.style.getPropertyPriority("top")).toBe("important");
  expect(gesture("start", "retry")).toBeTruthy();
  expect(gesture("finish", "retry")).toMatchObject({ left: 125, top: 54, sha256: originalHash });
  gesture("cancel", "first");
  expect(one.style.left).toBe("125px");
  gesture("commit", "retry", { changed: false });
  expect(gesture("start", "after-noop")).toBeTruthy();
});


it("returns a whole-path delta when auto-keyframe is off, independently of the current tween translation", () => {
  const { gesture } = createScene();
  vi.stubGlobal("gsap", { getProperty: () => 80 });
  try {
    expect(gesture("start","path")).toBeTruthy();
    expect(gesture("finish","path",{wholePath:true})).toMatchObject({position:{time:0,delta:{x:25,y:50}}});
  } finally {
    vi.unstubAllGlobals();
  }
});

it("resizes the selected corner and rolls back a rejected gesture", () => {
  const { one, gesture } = createScene();
  expect(gesture("start", "s", {corner:"se"})).toBeTruthy();
  expect(gesture("finish", "s")).toMatchObject({corner:"se",width:45,height:60});
  expect(one.style.width).toBe("45px");
  expect(one.style.left).toBe("");
  gesture("cancel", "s");
  expect(one.style.width).toBe("");
  expect(gesture("start", "n", {corner:"nw"})).toBeTruthy();
  expect(gesture("finish","n",{dx:-.1,dy:-.05})).toMatchObject({corner:"nw",left:-10,top:-5,width:30,height:15});
});

it("cannot resize an invisible target from a stale handle, including a target hidden mid-gesture", () => {
  const { one, gesture } = createScene(true);
  const corner = { corner: "se" };
  one.style.visibility = "hidden";
  expect(gesture("start", "hidden", corner)).toBeNull();
  one.style.visibility = "visible";
  expect(gesture("start", "moving", corner)).toBeTruthy();
  gesture("move", "moving");
  expect(one.style.width).not.toBe("");
  one.style.visibility = "hidden";
  expect(gesture("finish", "moving")).toBeNull();
  expect(one.style.width).toBe("");
});

it.each(["canvas", "img", "video", "span"])("respects intrinsic sizing for inline %s elements", tag => {
  const {one, gesture} = createScene(true, false, tag);
  one.style.display = "inline";
  const start = gesture("start", "corner", {corner:"se"});
  if (tag === "span") {
    expect(start).toBeNull();
    return;
  }
  expect(start).toBeTruthy();
  expect(gesture("finish", "corner")).toMatchObject({corner:"se", width:45, height:60});
});
