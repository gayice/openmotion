// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import * as preview from "../player/peerTimingPreview";
import { forgetSource, rememberSource } from "../utils/confirmedTextSources";
import { refreshSavedCanvasPreview } from "./submitIsolatedCanvasEdit";

const path = "compositions/intro.html";

afterEach(() => {
  forgetSource("p", path);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("releases the writer immediately and discards an older scene reply after a newer save", async () => {
  let finish!: (applied: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  const swap = vi.spyOn(preview, "tryRefreshPeerScene").mockReturnValue(pending);
  const frame = document.body.appendChild(document.createElement("iframe"));
  const reload = vi.fn();
  rememberSource("p", path, { version: "first", content: "one" });
  expect(refreshSavedCanvasPreview("p", { current: frame }, path, { [path]: "first" }, reload)).toBeUndefined();
  expect(swap).toHaveBeenCalledOnce();
  rememberSource("p", path, { version: "second", content: "two" });
  finish(false);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(reload).not.toHaveBeenCalled();
});
