import { render, act } from '@testing-library/react';
import { SessionProvider } from '../SessionProvider';
import { SessionContext, SessionContextValue } from '../SessionContext';
import { useAuth } from '../useAuth';
import { AuthContextType as AuthContextValue } from '../AuthContext';
import { getSessionHistory } from '@/lib/storage';
import { vi } from 'vitest';
import React from 'react';
import { User } from '@supabase/supabase-js';

// Mock dependencies
vi.mock('../useAuth');
vi.mock('@/lib/storage');

const mockUseAuth = vi.mocked(useAuth);
const mockGetSessionHistory = vi.mocked(getSessionHistory);

describe('SessionProvider', () => {
  it('fetches session history for a logged-in user', async () => {
    const mockUser = { id: '123', is_anonymous: false };
    const mockHistory = [{ id: 's1', user_id: '123', created_at: new Date().toISOString(), duration: 60 }];
    mockUseAuth.mockReturnValue({ user: mockUser as User } as AuthContextValue);
    mockGetSessionHistory.mockResolvedValue(mockHistory);

    let contextValue: SessionContextValue | undefined;
    await act(async () => {
      render(
        <SessionProvider>
          <SessionContext.Consumer>
            {(value) => {
              contextValue = value;
              return null;
            }}
          </SessionContext.Consumer>
        </SessionProvider>
      );
    });

    expect(mockGetSessionHistory).toHaveBeenCalledExactlyOnceWith('123');
    expect(contextValue?.sessionHistory).toEqual(mockHistory);
    expect(contextValue?.loading).toBe(false);
  });


  it('adds a session to the history', async () => {
    mockUseAuth.mockReturnValue({ user: { id: '123' } as User } as AuthContextValue);
    mockGetSessionHistory.mockResolvedValue([]);

    let contextValue: SessionContextValue | undefined;
    await act(async () => {
        render(
            <SessionProvider>
              <SessionContext.Consumer>
                {(value) => {
                  contextValue = value;
                  return null;
                }}
              </SessionContext.Consumer>
            </SessionProvider>
          );
    });

    const newSession = { id: 's2', user_id: '123', created_at: new Date().toISOString(), duration: 120 };
    act(() => {
      contextValue?.addSession(newSession);
    });

    expect(contextValue?.sessionHistory).toEqual([newSession]);
  });
});
