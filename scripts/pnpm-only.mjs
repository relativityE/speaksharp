/**
 * SpeakSharp: PNPM Enforcement Guard
 * This script ensures that the developer is using pnpm to run project commands.
 * npm and yarn are strictly forbidden to ensure lockfile integrity.
 */
if (!process.env.npm_config_user_agent || !process.env.npm_config_user_agent.startsWith('pnpm')) {
    console.error('\n\x1b[41m\x1b[37m ⛔ ERROR: PNPM MANDATE VIOLATED \x1b[0m');
    console.error('\x1b[31mSpeakSharp exclusively uses pnpm for dependency management and scripts.\x1b[0m');
    console.error('\x1b[33mPlease run this command using pnpm:\x1b[0m');
    console.error(`  \x1b[1m\x1b[32mpnpm ${process.argv.slice(2).join(' ') || '<command>'}\x1b[0m\n`);
    process.exit(1);
}
