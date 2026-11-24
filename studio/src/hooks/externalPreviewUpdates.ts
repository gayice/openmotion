/** Files still owed to this preview. A newer update can cover the same file independently. */
export class ExternalPreviewUpdates {
  private pending = new Map<string, symbol>();

  clear(): void {
    this.pending.clear();
  }

  track(
    files: readonly string[] | undefined,
    inPlace: Promise<boolean> | void,
    reload: (path: string | readonly string[]) => void,
  ): void {
    const ticket = Symbol();
    // A reconnect with unknown scope cannot be satisfied by an update to a known file.
    const keys = files?.length ? files : ["."];
    for (const key of keys) this.pending.set(key, ticket);

    const settle = (applied: boolean) => {
      const owed = keys.filter(key => this.pending.get(key) === ticket);
      if (!owed.length) return;
      if (applied) {
        for (const key of owed) this.pending.delete(key);
        return;
      }
      // A new preview reads the current project, including every file already delivered.
      const paths = [...this.pending.keys()];
      this.clear();
      if (paths.includes(".")) reload(".");
      else reload(paths.length === 1 ? paths[0] : paths);
    };
    if (inPlace) void inPlace.then(settle, () => settle(false));
    else settle(false);
  }
}
