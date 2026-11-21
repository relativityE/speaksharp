import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileFunction, createContext } from 'node:vm';
import { expect, test, type Route } from '@playwright/test';
import ts from 'typescript';
import { parseCompletionAttempt } from '../live/helpers/rwtSaveRetryAttempts';
import { goToApp } from './helpers';

const sourcePath = 'tests/live/rwt-save-retry-recovery.live.spec.ts';
const endpoint = '/rest/v1/rpc/complete_session_v2';
const take = '11111111-1111-4111-8111-111111111111';

// Execute only the live spec's actual completion route callback, not the live spec or signup.
function completionRoute(source: string) {
    const parsed = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ESNext, true);
    const routes: ts.ArrowFunction[] = [];
    function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && node.expression.expression.getText(parsed) === 'page' && node.expression.name.text === 'route'
            && node.arguments[0]?.getText(parsed) === 'COMPLETION_RPC'
            && node.arguments[1] && ts.isArrowFunction(node.arguments[1])) {
            routes.push(node.arguments[1]);
        }
        ts.forEachChild(node, visit);
    }
    visit(parsed);
    if (routes.length !== 1) throw new Error('Expected one completion route in the live Retry Save spec');
    const body = ts.transpileModule(`const callback = ${routes[0].getText(parsed)};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    return compileFunction(`${body}\nreturn callback;`, [
        'drop', 'variant', 'retryMarked', 'completions', 'parseCompletionAttempt', 'attempts', 'attemptByRequest',
    ], { parsingContext: createContext(Object.create(null)) });
}

test('J4.a leaves the first save upstream count at zero and sends exactly one Retry', async ({ page }) => {
    const upstream: string[] = [];
    const server = createServer((req, res) => {
        if (req.method === 'POST' && req.url === endpoint) {
            req.setEncoding('utf8');
            let body = '';
            req.on('data', (chunk: string) => { body += chunk; });
            req.on('end', () => {
                upstream.push(body);
                res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
            });
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><html data-app-ready="true" data-app-visible-ready="true"><title>SpeakSharp</title><main>Local save fixture</main></html>');
        }
    });
    await new Promise<void>((done, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', done);
    });
    try {
        const bound = server.address();
        if (!bound || typeof bound === 'string') throw new Error('Missing local fixture port');
        const origin = `http://127.0.0.1:${bound.port}`;
        const execute = completionRoute(readFileSync(resolve(process.cwd(), sourcePath), 'utf8'));
        const body = JSON.stringify({ p_session_id: take, p_status: 'completed' });
        const drop = { dropped: false, forwarded: false, completionPosts: 0 };
        let retry = false;
        const attempts: ReturnType<typeof parseCompletionAttempt>[] = [];
        const byRequest = new Map();
        const observer = { track: () => {}, markDropped: () => {} };
        await page.route(`${origin}${endpoint}`, (route: Route) => execute(
            drop, 'request-lost', retry, observer, parseCompletionAttempt, attempts, byRequest,
        )(route));
        await goToApp(page, origin);
        const post = () => page.evaluate(async ({ path, payload }) => {
            try {
                const response = await fetch(path, { method: 'POST', body: payload });
                return response.status;
            } catch { return 'lost'; }
        }, { path: endpoint, payload: body });

        expect(await post()).toBe('lost');
        expect(upstream, 'the first save must not reach the server').toEqual([]);
        retry = true;
        expect(await post()).toBe(200);
        expect(upstream, 'exactly the Retry request reaches the server').toEqual([body]);
        expect(attempts.map(({ dropped, afterRetry, sessionId }) => [dropped, afterRetry, sessionId]))
            .toEqual([[true, false, take], [false, true, take]]);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
    }
});
