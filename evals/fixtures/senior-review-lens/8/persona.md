Diff:
```diff
diff --git a/src/translation/engine-error.filter.ts b/src/translation/engine-error.filter.ts
new file mode 100644
--- /dev/null
+++ b/src/translation/engine-error.filter.ts
@@ -0,0 +1,46 @@
+import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
+import { ENGINE_ERROR_CODE, EngineError, EngineErrorCode } from './engine.error';
+
+const PROBLEM_CONTENT_TYPE = 'application/problem+json';
+const REQUEST_ID_HEADER = 'x-request-id';
+
+const STATUS_BY_CODE: Readonly<Record<EngineErrorCode, HttpStatus>> = {
+  [ENGINE_ERROR_CODE.TIMEOUT]: HttpStatus.GATEWAY_TIMEOUT,
+  [ENGINE_ERROR_CODE.REJECTED]: HttpStatus.BAD_GATEWAY,
+};
+
+const TITLE_BY_CODE: Readonly<Record<EngineErrorCode, string>> = {
+  [ENGINE_ERROR_CODE.TIMEOUT]: 'Translation engine timed out',
+  [ENGINE_ERROR_CODE.REJECTED]: 'Translation engine rejected the request',
+};
+
+interface HttpRequest {
+  headers: Record<string, string | undefined>;
+}
+
+interface HttpResponse {
+  status(code: number): HttpResponse;
+  type(contentType: string): HttpResponse;
+  json(body: unknown): void;
+}
+
+@Catch(EngineError)
+export class EngineErrorFilter implements ExceptionFilter<EngineError> {
+  catch(error: EngineError, host: ArgumentsHost): void {
+    const http = host.switchToHttp();
+    const request = http.getRequest<HttpRequest>();
+    const status = STATUS_BY_CODE[error.code];
+
+    http
+      .getResponse<HttpResponse>()
+      .status(status)
+      .type(PROBLEM_CONTENT_TYPE)
+      .json({
+        type: 'about:blank',
+        title: TITLE_BY_CODE[error.code],
+        status,
+        detail: `${error.engine} could not translate the text`,
+        requestId: request.headers[REQUEST_ID_HEADER],
+      });
+  }
+}
diff --git a/src/translation/translation.module.ts b/src/translation/translation.module.ts
--- a/src/translation/translation.module.ts
+++ b/src/translation/translation.module.ts
@@ -1,4 +1,8 @@
 import { Module } from '@nestjs/common';
+import { APP_FILTER } from '@nestjs/core';
+import { EngineErrorFilter } from './engine-error.filter';
 
-@Module({})
+@Module({
+  providers: [{ provide: APP_FILTER, useClass: EngineErrorFilter }],
+})
 export class TranslationModule {}
diff --git a/test/translation/engine-error.filter.spec.ts b/test/translation/engine-error.filter.spec.ts
new file mode 100644
--- /dev/null
+++ b/test/translation/engine-error.filter.spec.ts
@@ -0,0 +1,49 @@
+import { ArgumentsHost } from '@nestjs/common';
+import { EngineErrorFilter } from '../../src/translation/engine-error.filter';
+import { ENGINE_ERROR_CODE, EngineError } from '../../src/translation/engine.error';
+
+const capture = (error: EngineError, headers: Record<string, string> = {}) => {
+  const response = { status: jest.fn(), type: jest.fn(), json: jest.fn() };
+  response.status.mockReturnValue(response);
+  response.type.mockReturnValue(response);
+  const host = {
+    switchToHttp: () => ({ getRequest: () => ({ headers }), getResponse: () => response }),
+  } as unknown as ArgumentsHost;
+
+  new EngineErrorFilter().catch(error, host);
+
+  return response;
+};
+
+describe('EngineErrorFilter', () => {
+  it('returns an RFC 7807 problem+json body for ENGINE_TIMEOUT', () => {
+    const response = capture(new EngineError(ENGINE_ERROR_CODE.TIMEOUT, 'DeepL'));
+
+    expect(response.status).toHaveBeenCalledWith(504);
+    expect(response.type).toHaveBeenCalledWith('application/problem+json');
+    // RFC 7807 §4.2: "about:blank" when the problem type carries no extra semantics
+    expect(response.json).toHaveBeenCalledWith(
+      expect.objectContaining({ type: 'about:blank', title: 'Translation engine timed out', status: 504 }),
+    );
+  });
+
+  it('maps ERR_UPSTREAM_4XX to 502 per RFC 9110 §15.6.3', () => {
+    const response = capture(new EngineError(ENGINE_ERROR_CODE.REJECTED, 'DeepL'));
+
+    expect(response.status).toHaveBeenCalledWith(502);
+  });
+
+  it('names the engine in the detail without exposing its error', () => {
+    const response = capture(new EngineError(ENGINE_ERROR_CODE.REJECTED, 'DeepL'));
+
+    expect(response.json).toHaveBeenCalledWith(
+      expect.objectContaining({ detail: 'DeepL could not translate the text' }),
+    );
+  });
+
+  it('echoes the caller request id so support can find the call', () => {
+    const response = capture(new EngineError(ENGINE_ERROR_CODE.TIMEOUT, 'DeepL'), { 'x-request-id': 'req-42' });
+
+    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-42' }));
+  });
+});
```
Engine failures used to reach clients as a bare 500 from the default Nest handler. This filter answers them as problem details instead. `EngineError` and `ENGINE_ERROR_CODE` already exist; the adapters throw them. The spec sits beside the other translation unit specs.
