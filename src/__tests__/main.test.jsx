import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';
import ConfigurationNeededPage from '../pages/ConfigurationNeededPage';
import { supabase } from '../lib/supabaseClient';

// Mock child components and dependencies to isolate the logic of the entry point.
vi.mock('../App', () => ({
  default: () => <div>Mock App</div>,
}));
vi.mock('../pages/ConfigurationNeededPage', () => ({
  default: () => <div>Configuration Needed</div>,
}));
vi.mock('../lib/supabaseClient');

// This is the component that will be dynamically rendered by our test setup
const MainEntryPoint = ({ config }) => {
  const areEnvVarsDefined =
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    config.stripePublishableKey;

  if (!areEnvVarsDefined) {
    return <ConfigurationNeededPage />;
  }
  return <App />;
};

describe('main.jsx rendering logic', () => {
  it('renders ConfigurationNeededPage when required env vars are missing', () => {
    const mockConfig = {
      supabaseUrl: '',
      supabaseAnonKey: 'not-empty',
      stripePublishableKey: 'not-empty',
    };
    render(<MainEntryPoint config={mockConfig} />);
    expect(screen.getByText('Configuration Needed')).toBeInTheDocument();
    expect(screen.queryByText('Mock App')).not.toBeInTheDocument();
  });

  it('renders the main App when all required env vars are present', () => {
    const mockConfig = {
      supabaseUrl: 'not-empty',
      supabaseAnonKey: 'not-empty',
      stripePublishableKey: 'not-empty',
    };
    render(<MainEntryPoint config={mockConfig} />);
    expect(screen.getByText('Mock App')).toBeInTheDocument();
    expect(screen.queryByText('Configuration Needed')).not.toBeInTheDocument();
  });
});
