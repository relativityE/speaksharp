/**
 * #1424 — THE PRODUCTION REQUEST IS BUILT FROM THE PINNED CONTRACT, PROVEN AGAINST THE AST.
 *
 * `contract.json` pins the model, the generation config, the prompt, the six-word budget and the
 * ten-per-UTC-day cap. A contract nobody reads is decoration, so this suite proves the deployed function
 * actually derives its request from it.
 *
 * WHY IT LIVES HERE. #1434 tried to prove the same thing by scanning source with regexes from a workflow
 * job that installs no dependencies, and Codex defeated three successive versions of it (`3995449453`,
 * `3995482306`, `3995482308`, `3995482310`, and security `3995491120`). The claim was withdrawn from
 * there and moved here, where the real TypeScript compiler exists and runs on every pull request,
 * against the tree being merged.
 *
 * WHY IT IS BUILT AROUND `bindingFailures(source)`. Codex then found three false-PASS defects in the
 * first version of this very test (`3996197157`, `3996197160`, `3996197163`) — I had brought a parser
 * and kept reaching for regex inside it. The checks are a pure function of source text so the suite can
 * run them against the REAL function and against each defeating construction, which makes the
 * discrimination permanent evidence instead of something I verified by hand once.
 *
 * WHAT THIS STILL DOES NOT PROVE: that Google serves the model. That is answered in Production, where
 * suggestions generate automatically after every successful completed session.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const FUNCTION_PATH = 'backend/supabase/functions/get-ai-suggestions/index.ts';
const GEMINI_HOST = 'generativelanguage.googleapis.com';

/**
 * Every way the production request can stop deriving from the contract, as a list of failures. Empty
 * means the request is bound. Each check is named for what it refuses.
 */
export function bindingFailures(sourceText: string): string[] {
    const source = ts.createSourceFile(FUNCTION_PATH, sourceText, ts.ScriptTarget.Latest, true);
    const text = (node: ts.Node) => node.getText(source);

    const collect = <T extends ts.Node>(match: (node: ts.Node) => node is T): T[] => {
        const found: T[] = [];
        const visit = (node: ts.Node) => {
            if (match(node)) found.push(node);
            ts.forEachChild(node, visit);
        };
        ts.forEachChild(source, visit);
        return found;
    };
    const within = (node: ts.Node, outer: ts.Node) => node.getStart() >= outer.getStart() && node.getEnd() <= outer.getEnd();

    const contractImport = collect(ts.isImportDeclaration)
        .find((node) => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === './contract.json');
    const contract = contractImport?.importClause?.name?.text;
    if (!contract) return ['does not import ./contract.json'];

    /*
     * MODULE-LEVEL declarations only (Codex `3996197157`). Walking every scope and keying by name let a
     * helper-local `const GEMINI_GENERATION_CONFIG = contract.generationConfig` answer for a module
     * binding that had diverged, so the test validated a symbol production never sends.
     */
    const moduleInitialisers = new Map<string, ts.Expression>();
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.initializer) {
                moduleInitialisers.set(declaration.name.text, declaration.initializer);
            }
        }
    }

    /** The expression's own text plus the module-level initialisers of the identifiers it reads. */
    const resolved = (expression: ts.Expression): string => [
        text(expression),
        ...collect(ts.isIdentifier)
            .filter((node) => within(node, expression))
            .map((node) => moduleInitialisers.get(node.text))
            .filter((value): value is ts.Expression => Boolean(value))
            .map(text),
    ].join('\n');

    const failures: string[] = [];

    /*
     * Provider calls are identified BY DESTINATION (Codex `3996197160`). Selecting them by "the arguments
     * mention generationConfig" filtered a second Gemini call out before the count, so production could
     * hold an unvalidated request while the suite reported exactly one. A `fetch(` inside a string is not
     * a CallExpression, so a literal cannot inflate or satisfy this either.
     */
    const providerCalls = collect(ts.isCallExpression)
        .filter((call) => text(call.expression) === 'fetch')
        .filter((call) => call.arguments.length > 0 && resolved(call.arguments[0]).includes(GEMINI_HOST));

    if (providerCalls.length !== 1) {
        failures.push(providerCalls.length === 0
            ? 'no request to the provider was found'
            : `${providerCalls.length} provider requests found; exactly one is required so the checked call is the call made`);
        return failures;
    }

    const [call] = providerCalls;
    const propertyOf = (name: string): ts.Expression | undefined => collect(ts.isPropertyAssignment)
        .filter((assignment) => within(assignment, call))
        .find((assignment) => (ts.isIdentifier(assignment.name) || ts.isStringLiteral(assignment.name))
            && assignment.name.text === name)?.initializer;

    // 1. THE URL the request actually uses.
    const endpoint = resolved(call.arguments[0]);
    if (!new RegExp(`models/\\$\\{\\s*${contract}\\.model\\s*\\}`).test(endpoint)) {
        failures.push('the request URL does not resolve to the contract model');
    }
    /*
     * Hardcoded model names are looked for in STRING AND TEMPLATE LITERALS via the AST, not by stripping
     * comments from the text.
     *
     * The first attempt stripped comments with `/\/\/.*$/m` so a comment naming the retired model would
     * not fail a bound function — and `https://` contains `//`, so it deleted the rest of every URL line,
     * including the hardcoded model it existed to catch. My own casualty caught it, which is the same
     * failure mode Codex kept finding: reaching for text processing inside a parser. Comments are not
     * literals, so scanning literal nodes needs no stripping and cannot make that mistake.
     */
    const hardcodedModel = [...collect(ts.isStringLiteral), ...collect(ts.isTemplateLiteral)]
        .some((literal) => /models\/gemini-[A-Za-z0-9.-]+/.test(text(literal)));
    if (hardcodedModel) {
        failures.push('an endpoint path hardcodes a model name');
    }

    // 2. THE GENERATION CONFIG it sends — the contract value EXACTLY. A spread or merge is not it.
    const configExpression = propertyOf('generationConfig');
    const wantedConfig = `${contract}.generationConfig`;
    const configText = configExpression && ts.isIdentifier(configExpression)
        ? text(moduleInitialisers.get(configExpression.text) ?? configExpression)
        : configExpression && text(configExpression);
    if (configText !== wantedConfig) {
        failures.push('the request generation config is not the contract generation config');
    }

    /*
     * 3. THE PROMPT it sends, traced through the builder's RETURN (Codex `3996197163`). Searching the
     * builder's body text passed a builder that logged the contract template and returned a hardcoded
     * one. Every return must derive from the contract: a builder that sometimes returns something else
     * is a builder that can.
     */
    const readsTemplate = (node: ts.Node) => collect(ts.isPropertyAccessExpression)
        .some((access) => within(access, node) && text(access) === `${contract}.promptTemplate`);

    const promptExpression = propertyOf('text');
    const promptName = promptExpression && ts.isIdentifier(promptExpression) ? promptExpression.text : '';
    const promptDeclaration = collect(ts.isVariableDeclaration)
        .find((node) => ts.isIdentifier(node.name) && node.name.text === promptName && node.initializer);
    const bound = promptDeclaration?.initializer;

    if (!bound) {
        failures.push('the request prompt has no visible declaration');
    } else if (!readsTemplate(bound)) {
        const builderName = ts.isCallExpression(bound) ? text(bound.expression) : '';
        const builder = collect(ts.isFunctionDeclaration).find((node) => node.name?.text === builderName);
        const returns = builder ? collect(ts.isReturnStatement).filter((node) => within(node, builder)) : [];
        const derives = returns.length > 0 && returns.every((node) => node.expression && readsTemplate(node.expression));
        if (!derives) failures.push('the request prompt is not built from the contract template');
    }

    /*
     * 4. THE BUDGET AND THE CAP — from the contract AND referenced beyond their own declaration. A
     * declared-but-unused alias is production enforcing something else (Codex `3995482310`).
     */
    for (const [property, label] of [['wordBudget', 'word budget'], ['uncachedGenerationCapPerUtcDay', 'daily generation cap']] as const) {
        const name = [...moduleInitialisers.entries()]
            .find(([, initialiser]) => new RegExp(`${contract}\\.${property}\\b`).test(text(initialiser)))?.[0];
        if (!name) {
            failures.push(`the ${label} is not taken from the contract`);
            continue;
        }
        const references = collect(ts.isIdentifier).filter((node) => node.text === name).length;
        const declarations = collect(ts.isVariableDeclaration)
            .filter((node) => ts.isIdentifier(node.name) && node.name.text === name).length;
        if (references - declarations <= 0) failures.push(`the ${label} is declared but never used`);
    }

    return failures;
}

const productionSource = readFileSync(resolve(process.cwd(), FUNCTION_PATH), 'utf8');

/** The real function, mutated at one point. Each mutation is a construction that defeated an earlier version. */
const mutate = (from: string, to: string): string => {
    expect(productionSource, `mutation anchor must exist: ${from.slice(0, 48)}`).toContain(from);
    return productionSource.replace(from, to);
};

describe('#1424 — the production request is built from contract.json (AST)', () => {
    it('CONTROL: the real production function is bound to the contract', () => {
        expect(bindingFailures(productionSource)).toEqual([]);
    });

    it('CASUALTY: a function that does not import the contract fails', () => {
        expect(bindingFailures('const x = 1;\n')).toEqual(['does not import ./contract.json']);
    });

    it('CASUALTY (Codex 3996197157): a helper-local shadow cannot answer for the module binding', () => {
        // The module binding diverges; an inner scope re-declares the same NAME from the contract. Keying
        // resolution by name across all scopes accepted this and validated a symbol production never sends.
        const shadowed = mutate(
            'export const GEMINI_GENERATION_CONFIG = coachingContract.generationConfig;',
            `export const GEMINI_GENERATION_CONFIG = { responseMimeType: 'application/json' };
function decoyScope() {
  const GEMINI_GENERATION_CONFIG = coachingContract.generationConfig;
  return GEMINI_GENERATION_CONFIG;
}
void decoyScope;`,
        );
        expect(bindingFailures(shadowed)).toContain('the request generation config is not the contract generation config');
    });

    it('CASUALTY (Codex 3996197160): a SECOND Gemini call is counted even when its body is built in a variable', () => {
        // Selecting provider calls by request shape filtered this one out before the count, so the suite
        // reported one request while production made two, and validated only the well-formed one.
        const twoCalls = mutate(
            '      const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {',
            `      const shadowOptions = { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'coach me' }] }] }) };
      await fetch(\`\${GEMINI_API_URL}?key=\${apiKey}\`, shadowOptions);
      const geminiResponse = await fetch(\`\${GEMINI_API_URL}?key=\${apiKey}\`, {`,
        );
        expect(bindingFailures(twoCalls)).toEqual(['2 provider requests found; exactly one is required so the checked call is the call made']);
    });

    it('CASUALTY (Codex 3996197163): a builder that LOGS the template but RETURNS a hardcoded one fails', () => {
        // Searching the builder's body text passed this. The check follows the returned expression now.
        const hardcodedReturn = mutate(
            '  return coachingContract.promptTemplate.replace(',
            `  console.log('using template', coachingContract.promptTemplate.length);
  return \`Coach this transcript: \${transcriptForPrompt} \${metricsText}\`;
  return coachingContract.promptTemplate.replace(`,
        );
        expect(bindingFailures(hardcodedReturn)).toContain('the request prompt is not built from the contract template');
    });

    it('CASUALTY: a spread-merged generation config is not the contract value', () => {
        const merged = mutate(
            'export const GEMINI_GENERATION_CONFIG = coachingContract.generationConfig;',
            'export const GEMINI_GENERATION_CONFIG = { ...coachingContract.generationConfig, candidateCount: 99 };',
        );
        expect(bindingFailures(merged)).toContain('the request generation config is not the contract generation config');
    });

    it('CASUALTY: a hardcoded endpoint model fails even when the contract is imported', () => {
        const hardcoded = mutate(
            'export const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${coachingContract.model}:generateContent`;',
            "export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';",
        );
        expect(bindingFailures(hardcoded)).toEqual(expect.arrayContaining([
            'the request URL does not resolve to the contract model',
            'an endpoint path hardcodes a model name',
        ]));
    });

    it('CASUALTY: a word budget taken from the contract but never used fails', () => {
        const unused = mutate(
            'if (countWords(candidate.what_worked) > COACHING_WORD_BUDGET.what_worked) return null;',
            'if (countWords(candidate.what_worked) > 22) return null;',
        ).replace(
            'if (countWords(candidate.what_to_try_next) > COACHING_WORD_BUDGET.what_to_try_next) return null;',
            'if (countWords(candidate.what_to_try_next) > 22) return null;',
        );
        expect(bindingFailures(unused)).toContain('the word budget is declared but never used');
    });

    it('CONTROL: a comment naming the retired preview model does not fail the binding', () => {
        // The function carries a comment explaining why it left `gemini-3-flash-preview`. Documentation is
        // not a request, and the hardcoded-model check reads code with comments stripped.
        expect(productionSource).toContain('gemini-3-flash-preview');
        expect(bindingFailures(productionSource)).toEqual([]);
    });
});
