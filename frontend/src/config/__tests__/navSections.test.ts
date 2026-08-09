import { describe, it, expect } from 'vitest';
import {
    NAV_SECTIONS,
    NAV_ITEM_ACTIVE_CLASS,
    NAV_ITEM_BASE_CLASS,
    findMatchingNavSections,
    navItemClassName,
    normalizeNavPath,
    resolveNavSectionId,
} from '../navSections';

describe('navSections — route -> active section resolution', () => {
    it('resolves the authenticated root / to Home', () => {
        expect(resolveNavSectionId('/')).toBe('home');
    });

    it('resolves /practice to Home', () => {
        expect(resolveNavSectionId('/practice')).toBe('home');
    });

    it('resolves /session to Session', () => {
        expect(resolveNavSectionId('/session')).toBe('session');
    });

    it('resolves a nested session route /session/abc123 to Session', () => {
        expect(resolveNavSectionId('/session/abc123')).toBe('session');
    });

    it('resolves /analytics and a nested analytics route to Analytics', () => {
        expect(resolveNavSectionId('/analytics')).toBe('analytics');
        expect(resolveNavSectionId('/analytics/session-42')).toBe('analytics');
    });

    it('does NOT activate Session for the prefix-sharing sibling /session-other', () => {
        // Boundary rule: a plain startsWith() would wrongly light up Session here.
        expect(resolveNavSectionId('/session-other')).toBeNull();
        expect(resolveNavSectionId('/sessions')).toBeNull();
        expect(resolveNavSectionId('/analytics-archive')).toBeNull();
        expect(resolveNavSectionId('/practice-mode')).toBeNull();
    });

    it('resolves an unmapped route to no active section', () => {
        expect(resolveNavSectionId('/pricing')).toBeNull();
        expect(resolveNavSectionId('/auth/signin')).toBeNull();
        expect(resolveNavSectionId('/definitely/not/a/page')).toBeNull();
    });

    it('treats trailing slashes as the same route', () => {
        expect(resolveNavSectionId('/session/')).toBe('session');
        expect(resolveNavSectionId('/analytics//')).toBe('analytics');
        expect(resolveNavSectionId('')).toBe('home');
        expect(normalizeNavPath('/session/')).toBe('/session');
        expect(normalizeNavPath('/')).toBe('/');
        expect(normalizeNavPath(undefined)).toBe('/');
    });

    it('matches case-insensitively, because react-router does', () => {
        // /Session, /Practice and /ANALYTICS really do render those pages (only
        // /admin/ops-status opts into caseSensitive), so they must highlight too.
        expect(resolveNavSectionId('/Session')).toBe('session');
        expect(resolveNavSectionId('/SESSION/ABC123')).toBe('session');
        expect(resolveNavSectionId('/Practice')).toBe('home');
        expect(resolveNavSectionId('/ANALYTICS')).toBe('analytics');
        expect(resolveNavSectionId('/Analytics/Session-42')).toBe('analytics');
        expect(normalizeNavPath('/Session/')).toBe('/session');
        // Case-insensitivity must not weaken the boundary rule.
        expect(resolveNavSectionId('/Session-Other')).toBeNull();
    });

    it('never matches two sections for the same route', () => {
        // /faq is intentionally absent: the FAQ is an inline dropdown, not a routed section.
        const mapped = ['/', '/practice', '/practice/warmup', '/session', '/session/abc123', '/analytics', '/analytics/42'];
        for (const route of mapped) {
            expect(findMatchingNavSections(route)).toHaveLength(1);
        }
        // Zero is allowed only for an intentionally unmapped route.
        expect(findMatchingNavSections('/pricing')).toHaveLength(0);
    });

    it('exposes one config entry per page so adding a page is a single-entry change', () => {
        // FAQ is deliberately NOT a section: it renders as an inline dropdown control in the
        // nav (see @/components/faq/FaqMenu), never as a routed page.
        expect(NAV_SECTIONS.map((s) => s.id)).toEqual(['home', 'session', 'analytics']);
        for (const section of NAV_SECTIONS) {
            expect(section.label).toBeTruthy();
            expect(section.path.startsWith('/')).toBe(true);
            expect(section.matchPaths.length).toBeGreaterThan(0);
            // lucide-react icons are forwardRef components (objects), not plain functions.
            expect(section.icon).toBeTruthy();
        }
    });

    it('adds only the colour-changing modifier class when active', () => {
        expect(navItemClassName(false)).toBe(NAV_ITEM_BASE_CLASS);
        expect(navItemClassName(true)).toBe(`${NAV_ITEM_BASE_CLASS} ${NAV_ITEM_ACTIVE_CLASS}`);
    });
});
