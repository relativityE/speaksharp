/**
 * #1424 — THE PRODUCTION REQUEST IS BUILT FROM THE PINNED CONTRACT, PROVEN AGAINST THE AST.
 *
 * `contract.json` pins the model, the generation config, the prompt, the six-word budget and the ten-per
 * -UTC-day cap. A contract nobody reads is decoration, so this suite proves the deployed function
 * actually derives its request from it.
 *
 * WHY THIS TEST EXISTS HERE RATHER THAN IN #1434's HARNESS. #1434 tried to prove the same thing by
 * scanning the source with regexes, from a workflow job that installs no dependencies. Codex defeated
 * three successive versions of that: decoy declarations satisfied source-wide greps (`3995449453`); a
 * `fetch` written inside a template literal was read as the live call (`3995482306`); a spread-merged
 * generation config satisfied a substring check (`3995482308`); declared-but-unused budget and cap
 * aliases passed (`3995482310`); and the security review showed the same gap could bless a candidate
 * that exfiltrates the credential (`3995491120`). The claim was withdrawn from there and moved here,
 * where the real TypeScript compiler is available and runs on every pull request.
 *
 * A parser removes the whole class of defect: a `fetch` inside a string literal is a string, not a call;
 * a spread is a SpreadAssignment and not a property access; and an alias that is never referenced is
 * visibly never referenced.
 *
 * WHAT THIS STILL DOES NOT PROVE: that Google serves the model. That is answered in Production, where
 * suggestions generate automatically after every successful completed session.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const FUNCTION_PATH = 'backend/supabase/functions/get-ai-suggestions/index.ts';

const source = ts.createSourceFile(
    FUNCTION_PATH,
    readFileSync(resolve(process.cwd(), FUNCTION_PATH), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
);

const collect = <T extends ts.Node>(match: (node: ts.Node) => node is T): T[] => {
    const found: T[] = [];
    const visit = (node: ts.Node) => {
        if (match(node)) found.push(node);
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    return found;
};

/** The local name the module binds `./contract.json` to. Absent = nothing below can pass. */
const contractBinding = (): string => {
    const declaration = collect(ts.isImportDeclaration)
        .find((node) => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === './contract.json');
    const name = declaration?.importClause?.name;
    return name ? name.text : '';
};

/** Every module-level `const NAME = …` initialiser, by name. One level of resolution, done on the AST. */
const initialisers = (): Map<string, ts.Expression> => {
    const map = new Map<string, ts.Expression>();
    for (const declaration of collect(ts.isVariableDeclaration)) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            map.set(declaration.name.text, declaration.initializer);
        }
    }
    return map;
};

const text = (node: ts.Node) => node.getText(source);

/** Does this expression read `<contract>.<property>`, directly or through one `const` hop? */
const readsContract = (expression: ts.Expression | undefined, property: string): boolean => {
    if (!expression) return false;
    const wanted = `${contractBinding()}.${property}`;
    if (text(expression) === wanted) return true;
    if (ts.isIdentifier(expression)) {
        const resolved = initialisers().get(expression.text);
        // Deliberately one hop, and deliberately EXACT: a spread or a merge is not the contract's value,
        // which is the defect Codex demonstrated with `{ ...contract.generationConfig, candidateCount: 99 }`.
        return resolved ? text(resolved) === wanted : false;
    }
    return false;
};

/** All real `fetch(...)` calls. A `fetch(` written inside a string is not a CallExpression at all. */
const fetchCalls = collect(ts.isCallExpression).filter((call) => text(call.expression) === 'fetch');

/** The provider call: the `fetch` whose JSON body carries a `generationConfig`. */
const providerCalls = fetchCalls.filter((call) => call.arguments.some((argument) => /generationConfig/.test(text(argument))));

const propertyOf = (node: ts.Node, name: string): ts.Expression | undefined => {
    for (const assignment of collect(ts.isPropertyAssignment)) {
        if (assignment.getStart() < node.getStart() || assignment.getEnd() > node.getEnd()) continue;
        if (ts.isIdentifier(assignment.name) && assignment.name.text === name) return assignment.initializer;
        if (ts.isStringLiteral(assignment.name) && assignment.name.text === name) return assignment.initializer;
    }
    return undefined;
};

describe('#1424 — the production request is built from contract.json (AST)', () => {
    it('the module imports the contract', () => {
        expect(contractBinding()).not.toBe('');
    });

    it('CASUALTY: there is exactly ONE provider request, so the checked call is the call made', () => {
        // With two generation requests, verifying one proves nothing about the other. A `fetch` written
        // inside a template literal cannot inflate or satisfy this count — it is not a call node.
        expect({ providerCalls: providerCalls.length }).toEqual({ providerCalls: 1 });
    });

    it('CASUALTY: the request URL resolves to the contract model, with no hardcoded model anywhere', () => {
        const [call] = providerCalls;
        const url = call.arguments[0];
        // Collect the identifiers the URL expression reads, then resolve them on the AST.
        const referenced = collect(ts.isIdentifier)
            .filter((node) => node.getStart() >= url.getStart() && node.getEnd() <= url.getEnd())
            .map((node) => node.text);
        const resolved = referenced
            .map((name) => initialisers().get(name))
            .filter((value): value is ts.Expression => Boolean(value))
            .map(text)
            .concat(text(url));

        const endpoint = resolved.find((value) => value.includes('generativelanguage.googleapis.com'));
        expect(endpoint, 'the request URL must resolve to a Gemini endpoint').toBeDefined();
        expect(endpoint).toMatch(new RegExp(`models/\\$\\{${contractBinding()}\\.model\\}`));

        // And nothing in the whole module hardcodes a model into an endpoint path.
        const wholeFile = source.getText();
        expect(wholeFile.replace(/\/\/.*$|\/\*[^]*?\*\//gm, '')).not.toMatch(/models\/gemini-[A-Za-z0-9.-]+/);
    });

    it('CASUALTY: the generation config sent is the contract value exactly, not a merge of it', () => {
        // `{ ...contract.generationConfig, candidateCount: 99 }` must FAIL. Codex's 3995482308.
        const [call] = providerCalls;
        const config = propertyOf(call, 'generationConfig');
        expect(config, 'the request must send a generationConfig').toBeDefined();
        expect(readsContract(config, 'generationConfig')).toBe(true);
    });

    it('CASUALTY: the prompt sent is built from the contract template', () => {
        const [call] = providerCalls;
        const promptExpression = propertyOf(call, 'text');
        expect(promptExpression, 'the request must send prompt text').toBeDefined();

        // One hop: `text: prompt` → `const prompt = buildCoachingPrompt(…)` → that function's body must
        // read the contract's template.
        const promptName = promptExpression && ts.isIdentifier(promptExpression) ? promptExpression.text : '';
        const bound = initialisers().get(promptName);
        const builder = bound && ts.isCallExpression(bound) ? text(bound.expression) : '';
        const builderBody = collect(ts.isFunctionDeclaration)
            .find((node) => node.name?.text === builder);

        const reads = new RegExp(`${contractBinding()}\\.promptTemplate\\b`);
        const directly = bound ? reads.test(text(bound)) : false;
        const viaBuilder = builderBody ? reads.test(text(builderBody)) : false;
        expect(directly || viaBuilder, 'the prompt must come from the contract template').toBe(true);
    });

    it('CASUALTY: the word budget is taken from the contract AND actually used', () => {
        // Codex 3995482310: a declared-but-unused alias must not pass. On the AST, "used" means an
        // identifier reference that is not its own declaration name.
        const budgetName = [...initialisers().entries()]
            .find(([, initialiser]) => new RegExp(`${contractBinding()}\\.wordBudget\\b`).test(text(initialiser)))?.[0];
        expect(budgetName, 'a binding must derive from contract.wordBudget').toBeDefined();

        const references = collect(ts.isIdentifier).filter((node) => node.text === budgetName);
        const declarations = collect(ts.isVariableDeclaration)
            .filter((node) => ts.isIdentifier(node.name) && node.name.text === budgetName).length;
        expect(references.length - declarations, 'the binding must be referenced, not merely declared').toBeGreaterThan(0);

        // And it is used in a comparison that can refuse an over-budget field.
        const comparisons = collect(ts.isBinaryExpression).filter((node) =>
            node.operatorToken.kind === ts.SyntaxKind.GreaterThanToken && text(node).includes(String(budgetName)));
        expect(comparisons.length).toBeGreaterThan(0);
    });

    it('CASUALTY: the daily cap is taken from the contract AND actually used', () => {
        const capName = [...initialisers().entries()]
            .find(([, initialiser]) => new RegExp(`${contractBinding()}\\.uncachedGenerationCapPerUtcDay\\b`).test(text(initialiser)))?.[0];
        expect(capName, 'a binding must derive from contract.uncachedGenerationCapPerUtcDay').toBeDefined();

        const references = collect(ts.isIdentifier).filter((node) => node.text === capName);
        const declarations = collect(ts.isVariableDeclaration)
            .filter((node) => ts.isIdentifier(node.name) && node.name.text === capName).length;
        expect(references.length - declarations).toBeGreaterThan(0);
    });

    it('CONTROL: a comment naming the retired preview model does not fail the binding', () => {
        // The function carries a comment explaining why it left `gemini-3-flash-preview`. That comment is
        // documentation, not a request, and the AST checks above never see it.
        expect(source.getText()).toContain('gemini-3-flash-preview');
    });
});
