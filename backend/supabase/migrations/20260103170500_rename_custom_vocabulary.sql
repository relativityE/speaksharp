-- Rename table 'custom_vocabulary' to 'user_filler_words'
ALTER TABLE IF EXISTS custom_vocabulary RENAME TO user_filler_words;

-- Comment on table to reflect new purpose
COMMENT ON TABLE user_filler_words IS 'Stores user-defined filler words for detection and boosting.';
