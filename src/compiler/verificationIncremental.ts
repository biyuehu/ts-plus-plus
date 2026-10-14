/**
 * A bounded content-addressed cache for solver obligations. The complete
 * SMT-LIB input is the dependency key: changes to a referenced type, contract,
 * path fact, or compiler option change that input and therefore invalidate the
 * cached result without maintaining a second semantic dependency graph.
 *
 * @internal
 */
export class VerificationQueryCache<T> {
  private readonly entries = new Map<string, T>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly maximumSize: number) {}

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.hitCount++;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  recordMiss(): void {
    this.missCount++;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.maximumSize) this.entries.delete(this.entries.keys().next().value!);
  }

  clear(): void {
    this.entries.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  stats(): { readonly hits: number; readonly misses: number; readonly size: number; } {
    return { hits: this.hitCount, misses: this.missCount, size: this.entries.size };
  }
}
