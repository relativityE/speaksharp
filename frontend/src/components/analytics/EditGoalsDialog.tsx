import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings2 } from 'lucide-react';
import { type UserGoals } from '@/types/goals';

interface EditGoalsDialogProps {
    goals: UserGoals;
    onSave: (goals: UserGoals) => void;
}

export const EditGoalsDialog: React.FC<EditGoalsDialogProps> = ({ goals, onSave }) => {
    const [open, setOpen] = useState(false);
    const [weeklyGoal, setWeeklyGoal] = useState(goals.weeklyGoal);
    const [clarityGoal, setClarityGoal] = useState(goals.clarityGoal);

    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    const handleSave = async () => {
        // Validate and clamp values
        const validWeekly = Math.min(Math.max(1, weeklyGoal), 20);
        const validClarity = Math.min(Math.max(50, clarityGoal), 100);

        setIsSaving(true);
        await onSave({ weeklyGoal: validWeekly, clarityGoal: validClarity });
        setIsSaving(false);
        setShowSuccess(true);

        // Auto-close after success indicator is seen
        setTimeout(() => {
            setShowSuccess(false);
            setOpen(false);
        }, 1500);
    };

    const handleOpenChange = (isOpen: boolean) => {
        setOpen(isOpen);
        if (isOpen) {
            // Reset to current goals when opening
            setWeeklyGoal(goals.weeklyGoal);
            setClarityGoal(goals.clarityGoal);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    data-testid="edit-goals-button"
                >
                    <Settings2 className="h-4 w-4" />
                    <span className="sr-only">Edit Goals</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]" data-testid="edit-goals-dialog">
                <DialogHeader>
                    <DialogTitle>Edit Your Goals</DialogTitle>
                    <DialogDescription>
                        Set personalized targets for your weekly practice sessions and clarity score.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="weekly-goal" className="text-right">
                            Weekly Sessions
                        </Label>
                        <Input
                            id="weekly-goal"
                            type="number"
                            min={1}
                            max={20}
                            value={weeklyGoal}
                            onChange={(e) => setWeeklyGoal(parseInt(e.target.value) || 1)}
                            className="col-span-3"
                            data-testid="weekly-goal-input"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="clarity-goal" className="text-right">
                            Clarity Goal (%)
                        </Label>
                        <Input
                            id="clarity-goal"
                            type="number"
                            min={50}
                            max={100}
                            value={clarityGoal}
                            onChange={(e) => setClarityGoal(parseInt(e.target.value) || 50)}
                            className="col-span-3"
                            data-testid="clarity-goal-input"
                        />
                    </div>
                </div>
                <DialogFooter className="flex items-center justify-between sm:justify-between">
                    {showSuccess ? (
                        <span className="text-sm text-emerald-500 font-medium" data-testid="goals-save-success">
                            ✓ Goals saved!
                        </span>
                    ) : <span />}
                    <Button
                        type="submit"
                        onClick={() => { void handleSave(); }}
                        disabled={isSaving}
                        data-testid="save-goals-button"
                    >
                        {isSaving ? 'Saving...' : 'Save Goals'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
