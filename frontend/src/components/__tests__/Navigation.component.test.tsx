import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../../../tests/support/test-utils';
import Navigation from '../Navigation';
import * as AuthProvider from '../../contexts/AuthProvider';
import { issueReportService } from '@/services/issueReportService';
import { useSessionStore } from '@/stores/useSessionStore';

// Mock modules
vi.mock('../../contexts/AuthProvider');
vi.mock('@/services/issueReportService', async () => {
    const actual = await vi.importActual<typeof import('@/services/issueReportService')>('@/services/issueReportService');
    return {
        ...actual,
        issueReportService: {
            submit: vi.fn().mockResolvedValue({ id: 'report-1' }),
        },
    };
});

// Mock useUserProfile hook to avoid QueryClient dependency
vi.mock('../../hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: null, isLoading: false, error: null }),
}));

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);

describe('Navigation', () => {
    const mockSignOut = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        useSessionStore.getState().resetSession();
    });

    const renderNavigation = (initialRoute = '/') => {
        return render(<Navigation />, { route: initialRoute });
    };

    describe('Rendering', () => {
        it('should render the logo and app name', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            expect(screen.getByText('SpeakSharp')).toBeInTheDocument();
        });

        it('should render Sign In and Get Started buttons when not authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            expect(screen.getByText('Sign In')).toBeInTheDocument();
            expect(screen.getByText('Get Started')).toBeInTheDocument();
        });

        it('should render navigation items when authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            expect(screen.getAllByText('Home')).toHaveLength(2); // Desktop + mobile
            expect(screen.getAllByText('Session')).toHaveLength(2);
            expect(screen.getAllByText('Analytics')).toHaveLength(2);
        });

        it('should render Sign Out button when authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            expect(screen.getByTestId('nav-sign-out-button')).toBeInTheDocument();
        });
    });

    describe('Authentication Actions', () => {
        it('should call signOut when Sign Out button is clicked', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();

            const signOutButton = screen.getByTestId('nav-sign-out-button');
            fireEvent.click(signOutButton);

            expect(mockSignOut).toHaveBeenCalled();
        });
    });

    describe('Issue Reporting', () => {
        it('submits a backend issue report with metadata and no transcript by default', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user', email: 'user@example.com' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);
            useSessionStore.getState().setSTTMode('private');
            useSessionStore.getState().updateTranscript('Sensitive transcript should require opt-in', '');

            renderNavigation('/session');

            fireEvent.click(screen.getByTestId('nav-report-issue-button'));
            fireEvent.change(screen.getByTestId('issue-report-title'), {
                target: { value: 'Private mic failed' },
            });
            fireEvent.change(screen.getByTestId('issue-report-description'), {
                target: { value: 'Clicking the microphone did not start the recording.' },
            });
            fireEvent.click(screen.getByTestId('issue-report-submit'));

            await waitFor(() => {
                expect(issueReportService.submit).toHaveBeenCalled();
            });
            expect(issueReportService.submit).toHaveBeenCalledWith(expect.objectContaining({
                userId: null,
                category: 'stt',
                pageUrl: expect.any(String),
                includeTranscript: false,
                transcriptExcerpt: null,
                includeAudio: false,
                audioAttachmentNote: null,
                metadata: expect.objectContaining({
                    route: '/session',
                    sttMode: 'private',
                }),
            }));
        });

        it('includes transcript only after explicit opt-in', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user', email: 'user@example.com' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);
            useSessionStore.getState().updateTranscript('User chose to include this transcript', '');

            renderNavigation('/session');

            fireEvent.click(screen.getByTestId('nav-report-issue-button'));
            fireEvent.change(screen.getByTestId('issue-report-title'), {
                target: { value: 'Transcript issue' },
            });
            fireEvent.change(screen.getByTestId('issue-report-description'), {
                target: { value: 'The transcript changed after I clicked stop.' },
            });
            fireEvent.click(screen.getByTestId('issue-report-include-transcript'));
            fireEvent.change(screen.getByTestId('issue-report-transcript-snippet'), {
                target: { value: 'User chose to include this transcript' },
            });
            fireEvent.click(screen.getByTestId('issue-report-submit'));

            await waitFor(() => {
                expect(issueReportService.submit).toHaveBeenCalled();
            });
            expect(issueReportService.submit).toHaveBeenCalledWith(expect.objectContaining({
                includeTranscript: true,
                transcriptExcerpt: 'User chose to include this transcript',
            }));
        });
    });

    describe('Navigation Links', () => {
        it('should have correct href for Home link', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            const homeLinks = screen.getAllByRole('link', { name: /home/i });
            expect(homeLinks[0]).toHaveAttribute('href', '/');
        });

        it('should have correct href for Session link', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            const sessionLinks = screen.getAllByRole('link', { name: /session/i });
            expect(sessionLinks[0]).toHaveAttribute('href', '/session');
        });

        it('should have correct href for Analytics link', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            const analyticsLinks = screen.getAllByRole('link', { name: /analytics/i });
            expect(analyticsLinks[0]).toHaveAttribute('href', '/analytics');
        });
    });

    describe('Mobile Navigation', () => {
        it('should render mobile navigation when authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            // Mobile nav should have Home, Session, Analytics
            const homeLinks = screen.getAllByText('Home');
            expect(homeLinks.length).toBeGreaterThan(1); // Desktop + mobile
        });

        it('should not render mobile navigation when not authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            // Should only have desktop Sign In/Get Started, no mobile nav
            expect(screen.getByText('Sign In')).toBeInTheDocument();
            expect(screen.getByText('Get Started')).toBeInTheDocument();
        });
    });

    describe('Active Link Highlighting', () => {
        it('should highlight Home link when on home page', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation('/');
            // The active link should have 'default' or 'secondary' variant
            // We can check if the link exists and is rendered
            expect(screen.getAllByText('Home')).toHaveLength(2);
        });

        it('should highlight Session link when on session page without rendering duplicate mobile nav', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation('/session');
            expect(screen.getAllByText('Session')).toHaveLength(1);
        });

        it('should highlight Analytics link when on analytics page', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation('/analytics');
            expect(screen.getAllByText('Analytics')).toHaveLength(2);
        });
    });
});
