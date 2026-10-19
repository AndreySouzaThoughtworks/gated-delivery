Diff:
```diff
--- a/src/catalog/pagination.ts
+++ b/src/catalog/pagination.ts
@@ -3,3 +3,3 @@ export const toSkipTake = (page: number, size: number) => ({
-  skip: page * size,
+  skip: (page - 1) * size,
   take: size,
 });
--- /dev/null
+++ b/test/catalog/pagination.spec.ts
@@ -0,0 +1,10 @@
+import { toSkipTake } from '../../src/catalog/pagination';
+
+describe('toSkipTake', () => {
+  it('starts the first page at offset zero', () => {
+    expect(toSkipTake(1, 20)).toEqual({ skip: 0, take: 20 });
+  });
+  it('starts the second page after the first page', () => {
+    expect(toSkipTake(2, 20)).toEqual({ skip: 20, take: 20 });
+  });
+});
```
Pages are 1-based everywhere in the API (validated as >= 1 by the DTO). The bug: page 1 skipped the first 20 items. pagination.ts is the only caller-facing pagination helper; tests sit beside the existing catalog unit tests.
