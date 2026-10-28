import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {EditGoalsDialog} from '../EditGoalsDialog';
const goals={weeklyGoal:5,clarityGoal:90};
describe('goal save acknowledgment',()=>{
    it('a local-only result never shows the account-save success acknowledgment',async()=>{
        const save=vi.fn().mockResolvedValue({status:'local-only',goals,syncError:true});
        render(<EditGoalsDialog goals={goals} onSave={save} />);
        fireEvent.click(screen.getByRole('button',{name:'Edit Goals'}));
        fireEvent.click(screen.getByRole('button',{name:'Save Goals'}));
        await waitFor(()=>expect(save).toHaveBeenCalled());
        await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Saved on this device only. Account sync is unavailable.'));
        expect(screen.queryByTestId('goals-save-success')).toBeNull();
    });
    it('a verified account result earns the account-save acknowledgment',async()=>{
        const save=vi.fn().mockResolvedValue({status:'synced',goals,syncError:false});
        render(<EditGoalsDialog goals={goals} onSave={save} />);
        fireEvent.click(screen.getByRole('button',{name:'Edit Goals'}));
        fireEvent.click(screen.getByRole('button',{name:'Save Goals'}));
        await waitFor(()=>expect(screen.getByTestId('goals-save-success')).toHaveTextContent('Goals saved!'));
    });
    it('a rejected save leaves an actionable dialog and never exposes backend prose',async()=>{
        const save=vi.fn().mockRejectedValue(new Error('private diagnostic text'));
        render(<EditGoalsDialog goals={goals} onSave={save} />);
        fireEvent.click(screen.getByRole('button',{name:'Edit Goals'}));
        fireEvent.click(screen.getByRole('button',{name:'Save Goals'}));
        await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Goals could not be saved. Please try again.'));
        expect(screen.getByRole('button',{name:'Save Goals'})).toBeEnabled();
        expect(screen.queryByText(/private diagnostic text/)).toBeNull();
        expect(screen.queryByTestId('goals-save-success')).toBeNull();
    });
});
