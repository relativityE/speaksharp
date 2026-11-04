// Independent Security completion accompanying a GitHub Code review object in gate fixtures.
// There is deliberately no Code row: missing/dismissed Code evidence must still fail.
export const codexSecuritySummary = (headSha, pullRequestNumber, repository = 'relativityE/speaksharp') => ({
  author: { login: 'chatgpt-codex-connector[bot]' }, createdAt: '2026-09-08T10:01:00Z',
  body: '<!-- codex-pull-request-review-summary -->\n'
    + `<!-- codex-security-review:v1 ${JSON.stringify({ headSha, pullRequestNumber, repository, status: 'completed' })} -->\n`
    + '## Codex Review Summary\n',
});
