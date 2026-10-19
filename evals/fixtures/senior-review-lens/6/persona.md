Diff:
```diff
diff --git a/src/translation/engine-language.ts b/src/translation/engine-language.ts
new file mode 100644
--- /dev/null
+++ b/src/translation/engine-language.ts
@@ -0,0 +1,4 @@
+const LANGUAGE_SUBTAG_LENGTH = 2;
+
+export const toEngineLanguage = (locale: string): string =>
+  locale.slice(0, LANGUAGE_SUBTAG_LENGTH).toLowerCase();
diff --git a/src/translation/translate-request.dto.ts b/src/translation/translate-request.dto.ts
--- a/src/translation/translate-request.dto.ts
+++ b/src/translation/translate-request.dto.ts
@@ -1,9 +1,13 @@
-import { IsString, MaxLength } from 'class-validator';
+import { IsString, Matches, MaxLength } from 'class-validator';
 
 const MAX_TEXT_LENGTH = 5000;
+const LOCALE_PATTERN = /^[a-z]{2}([-_][a-z]{2})?$/i;
 
 export class TranslateRequestDto {
   @IsString()
   @MaxLength(MAX_TEXT_LENGTH)
   text!: string;
+
+  @Matches(LOCALE_PATTERN)
+  targetLocale!: string;
 }
diff --git a/src/translation/translation.service.ts b/src/translation/translation.service.ts
--- a/src/translation/translation.service.ts
+++ b/src/translation/translation.service.ts
@@ -1,12 +1,11 @@
+import { toEngineLanguage } from './engine-language';
 import { TranslateRequestDto } from './translate-request.dto';
 import { TranslationEngine } from './translation-engine.port';
 
-const DEFAULT_TARGET_LANGUAGE = 'en';
-
 export class TranslationService {
   constructor(private readonly engine: TranslationEngine) {}
 
   translate(request: TranslateRequestDto): Promise<string> {
-    return this.engine.translate(request.text, DEFAULT_TARGET_LANGUAGE);
+    return this.engine.translate(request.text, toEngineLanguage(request.targetLocale));
   }
 }
diff --git a/test/translation/translate-request.dto.spec.ts b/test/translation/translate-request.dto.spec.ts
new file mode 100644
--- /dev/null
+++ b/test/translation/translate-request.dto.spec.ts
@@ -0,0 +1,18 @@
+import { plainToInstance } from 'class-transformer';
+import { validateSync } from 'class-validator';
+import { TranslateRequestDto } from '../../src/translation/translate-request.dto';
+
+const errorsFor = (targetLocale: string) =>
+  validateSync(plainToInstance(TranslateRequestDto, { text: 'Hello', targetLocale }));
+
+describe('TranslateRequestDto', () => {
+  describe('targetLocale', () => {
+    it.each(['de', 'DE', 'de-DE', 'de-AT', 'de-CH', 'de_DE', 'De-ch'])('accepts %s', (locale) => {
+      expect(errorsFor(locale)).toHaveLength(0);
+    });
+
+    it.each(['', 'd', 'deu', 'de-', 'de-DEU', 'de DE'])('rejects "%s"', (locale) => {
+      expect(errorsFor(locale)).not.toHaveLength(0);
+    });
+  });
+});
diff --git a/test/translation/translation.service.spec.ts b/test/translation/translation.service.spec.ts
--- a/test/translation/translation.service.spec.ts
+++ b/test/translation/translation.service.spec.ts
@@ -5,6 +5,15 @@ describe('TranslationService', () => {
     const engine = { translate: jest.fn().mockResolvedValue('Hello') };
     const service = new TranslationService(engine);
 
-    await expect(service.translate({ text: 'Hallo' })).resolves.toBe('Hello');
+    await expect(service.translate({ text: 'Hallo', targetLocale: 'en' })).resolves.toBe('Hello');
+  });
+
+  it('asks the engine for the requested target language', async () => {
+    const engine = { translate: jest.fn().mockResolvedValue('Hallo') };
+    const service = new TranslationService(engine);
+
+    await service.translate({ text: 'Hello', targetLocale: 'de' });
+
+    expect(engine.translate).toHaveBeenCalledWith('Hello', 'de');
   });
 });
```
Adds a target language to the translate endpoint. Clients send a locale such as `de-AT`; the translation engine takes a two-letter language code only, so the region is accepted for client compatibility and not passed on. `TranslationService` is the only caller of `toEngineLanguage`. The new spec sits beside the existing translation unit tests, and the request DTO is validated by the global `ValidationPipe`.
