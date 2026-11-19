import { FOCUS_POINTS_DISCLOSURE, OPEN_MIC_DISCLOSURE, PROVIDER_DETAIL_HREF, PROVIDER_DETAIL_LABEL } from './reviewCopy';

/**
 * The review card's coaching disclosure: what is sent, plus a link to the Privacy Policy section that names the
 * current provider. A plain anchor in a new tab, so it needs no router and opening it never leaves the review.
 */
export const CoachingDisclosure = ({ product }: { product?: string | null }) => (
  <>
    {product === 'focus_points' ? FOCUS_POINTS_DISCLOSURE : OPEN_MIC_DISCLOSURE}{' '}
    <a
      href={PROVIDER_DETAIL_HREF}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-ink-text"
      data-testid="coaching-provider-detail-link"
    >
      {PROVIDER_DETAIL_LABEL}
    </a>
  </>
);
