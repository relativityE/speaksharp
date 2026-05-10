-- Harden user-defined filler words at the database boundary.
-- Frontend validation is UX; this trigger and constraint enforce shape/safety
-- for direct API writes as well.

CREATE OR REPLACE FUNCTION public.normalize_user_filler_word()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.word IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.word := lower(regexp_replace(btrim(NEW.word), '\s+', ' ', 'g'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_user_filler_word_before_write ON public.user_filler_words;

CREATE TRIGGER normalize_user_filler_word_before_write
BEFORE INSERT OR UPDATE OF word ON public.user_filler_words
FOR EACH ROW
EXECUTE FUNCTION public.normalize_user_filler_word();

ALTER TABLE public.user_filler_words
  ALTER COLUMN word SET NOT NULL;

ALTER TABLE public.user_filler_words
  DROP CONSTRAINT IF EXISTS user_filler_words_word_safe;

ALTER TABLE public.user_filler_words
  ADD CONSTRAINT user_filler_words_word_safe
  CHECK (
    length(btrim(word)) BETWEEN 1 AND 50
    AND word = lower(regexp_replace(btrim(word), '\s+', ' ', 'g'))
    AND word !~ '[[:cntrl:]]'
    AND word ~ '^[[:alnum:] ''’\-]+$'
  )
  NOT VALID;
