-- Enforce "Rolling 50" session limit per user
-- When a user exceeds 50 sessions, the oldest one is automatically deleted.

CREATE OR REPLACE FUNCTION rotate_user_sessions()
RETURNS TRIGGER AS $$
BEGIN
    -- Delete entries for this user if they exceed count of 50
    -- Benefit: Zero storage bloat, consistent fetch performance
    DELETE FROM sessions
    WHERE id IN (
        SELECT id
        FROM sessions
        WHERE user_id = NEW.user_id
        ORDER BY created_at DESC
        OFFSET 50
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger runs AFTER insert to ensure the new session is counted
DROP TRIGGER IF EXISTS trigger_rotate_sessions ON sessions;
CREATE TRIGGER trigger_rotate_sessions
AFTER INSERT ON sessions
FOR EACH ROW
EXECUTE FUNCTION rotate_user_sessions();
