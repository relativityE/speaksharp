import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HomePage } from '../../pages/HomePage';

describe('HomePage', () => {
  it('navigates to the session page when the button is clicked', () => {
    let testLocation;
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/session" element={<div>Session Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('Start New Session'));

    // This is a simplified way to test navigation.
    // In a real app, you might want to check the URL or the content of the new page.
    expect(screen.getByText('Session Page')).toBeInTheDocument();
  });
});
