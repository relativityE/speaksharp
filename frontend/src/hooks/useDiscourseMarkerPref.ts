import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useProfile } from './useProfile';
import { profileService } from '../services/domainServices';
import type { UserProfile } from '../types/user';
import logger from '../lib/logger';

/**
 * #1231 filler slice 2 — the discourse-marker opt-in preference.
 *
 * The filler HEADLINE counts true fillers (um/uh/ah) + the user's own tracked words by default;
 * discourse markers (like, so, you know, …) are opt-in. This hook reads that persisted choice from
 * the profile and writes it through the profile service, then refreshes the `userProfile` query so
 * every consumer (the live/after headline) reflects it. Absent column → false (see the migration).
 */
export const useDiscourseMarkerPref = () => {
    const { session } = useAuthProvider();
    const { profile } = useProfile();
    const queryClient = useQueryClient();
    const userId = session?.user?.id;

    const includeDiscourseMarkers = profile?.include_discourse_markers ?? false;

    const mutation = useMutation({
        mutationFn: async (next: boolean): Promise<UserProfile> => {
            if (!userId) throw new Error('No authenticated user');
            return profileService.update(userId, { include_discourse_markers: next });
        },
        onSuccess: (updated) => {
            // Write the server truth straight into the profile cache so the headline updates without a
            // refetch round-trip; still invalidate so any stale reader reconciles.
            if (userId) queryClient.setQueryData(['userProfile', userId], updated);
            void queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        },
        onError: (error) => {
            logger.error({ error }, '[useDiscourseMarkerPref] Failed to persist preference');
        },
    });

    return {
        includeDiscourseMarkers,
        setIncludeDiscourseMarkers: (next: boolean) => mutation.mutate(next),
        isSaving: mutation.isPending,
        error: mutation.error,
    };
};
