import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { openEntitlementModal, type EntitlementHookId } from './entitlementModalBus';
import './EntitlementTouchpointCards.css';

function trackGateClick(payload: {
  page_name: 'creative_studio' | 'assets';
  area: 'entitlement_gate';
  element: 'sign_in' | 'view_plans' | 'select_model' | 'open_pricing';
  hook_id: EntitlementHookId;
}) {
  if (typeof window === 'undefined') return;
  void import('./tracking').then(({ trackMotion }) => trackMotion('ui_click', payload));
}

/**
 * U6 · Inline guest sign-in card on Web Cloud generation forms
 * (replaces the desktop "provider needs setup" API-key hint with a 1-click sign-in CTA).
 */
export function GuestSignInInlineGate({ hookId = 'studio_generate' }: { hookId?: EntitlementHookId }) {
  const { t } = useI18n();
  return (
    <div className="om-entitlement-gate" role="status">
      <div className="om-entitlement-gate-copy">
        <strong>{t('Sign in to generate with OpenDesign models')}</strong>
        <p className="om-muted">{t('No API key setup needed. Sign in to start creating right away.')}</p>
      </div>
      <div className="om-entitlement-gate-actions">
        <Button
          variant="plain"
          className="om-button h-auto"
          data-primary
          onClick={() => {
            trackGateClick({ page_name: 'creative_studio', area: 'entitlement_gate', element: 'sign_in', hook_id: hookId });
            openEntitlementModal({ mode: 'guest', hookId });
          }}
        >
          <RemixIcon name="login-box-line" size={15} />
          {t('Sign in now')}
        </Button>
      </div>
    </div>
  );
}

/**
 * U6 · Borderless tonal gate card placed inline above the Generate button
 * when a Free / Go account selects an OpenDesign hosted media model.
 */
export function FreePlanGenerationGate({
  onOpenProviders,
  hookId = 'studio_free_gate',
}: {
  onOpenProviders?: () => void;
  hookId?: EntitlementHookId;
}) {
  const { t } = useI18n();
  return (
    <div className="om-entitlement-gate" role="status">
      <div className="om-entitlement-gate-copy">
        <strong>{t('Upgrade to Plus for hosted media models')}</strong>
        <p className="om-muted">{t('Your current plan does not include OpenDesign hosted image, video, or audio generation.')}</p>
      </div>
      <div className="om-entitlement-gate-actions">
        <Button
          variant="plain"
          className="om-button h-auto"
          data-primary
          onClick={() => {
            trackGateClick({ page_name: 'creative_studio', area: 'entitlement_gate', element: 'view_plans', hook_id: hookId });
            openEntitlementModal({ mode: 'upgrade', hookId });
          }}
        >
          <RemixIcon name="sparkling-line" size={15} />
          {t('Upgrade to Plus')}
        </Button>
        {onOpenProviders && (
          <Button variant="plain" className="om-button h-auto" onClick={onOpenProviders}>
            {t('Use own API key')}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * U6 · Borderless tonal gate card shown above Generate when a Plus/Pro account
 * selects an image resolution above their plan cap (offers 1-click downgrade keeping prompt).
 */
export function ResolutionCapGenerationGate({
  cap,
  onDowngrade,
  hookId = 'studio_res_gate',
}: {
  cap: '1K' | '2K';
  onDowngrade: () => void;
  hookId?: EntitlementHookId;
}) {
  const { t } = useI18n();
  return (
    <div className="om-entitlement-gate" role="status">
      <div className="om-entitlement-gate-copy">
        <strong>{t('Resolution exceeds your current plan')}</strong>
        <p className="om-muted">{t('Your plan supports up to {cap}. Switch to {cap} to keep your prompt, or upgrade your plan.', { cap })}</p>
      </div>
      <div className="om-entitlement-gate-actions">
        <Button
          variant="plain"
          className="om-button h-auto"
          data-primary
          onClick={() => {
            trackGateClick({ page_name: 'creative_studio', area: 'entitlement_gate', element: 'select_model', hook_id: hookId });
            onDowngrade();
          }}
        >
          {t('Switch to {cap}', { cap })}
        </Button>
        <Button
          variant="plain"
          className="om-button h-auto"
          onClick={() => {
            trackGateClick({ page_name: 'creative_studio', area: 'entitlement_gate', element: 'view_plans', hook_id: hookId });
            openEntitlementModal({ mode: 'upgrade', hookId });
          }}
        >
          <RemixIcon name="sparkling-line" size={15} />
          {t('Upgrade plan')}
        </Button>
      </div>
    </div>
  );
}

/**
 * U6 · Inline top-up CTA inside a failed generation card when credits/balance are insufficient.
 */
export function InsufficientBalanceFailureGate({ hookId = 'failure_card_topup' }: { hookId?: EntitlementHookId }) {
  const { t } = useI18n();
  return (
    <div className="om-entitlement-gate" data-tone="warning" role="alert">
      <div className="om-entitlement-gate-copy">
        <strong>{t('Not enough credits to generate')}</strong>
        <p className="om-muted">{t('Your prompt and references are preserved with no charge. Add credits or lower settings to retry.')}</p>
      </div>
      <div className="om-entitlement-gate-actions">
        <Button
          variant="plain"
          className="om-button h-auto"
          data-primary
          onClick={() => {
            trackGateClick({ page_name: 'creative_studio', area: 'entitlement_gate', element: 'open_pricing', hook_id: hookId });
            openEntitlementModal({ mode: 'upgrade', hookId });
          }}
        >
          <RemixIcon name="bank-card-line" size={15} />
          {t('Add credits')}
        </Button>
      </div>
    </div>
  );
}

/**
 * U7 · Inline session-expired (401) recovery bar — only shown when account.state === 'reauth-required'.
 */
export function SessionExpiredInlineGate({ hookId = 'session_expired_401' }: { hookId?: EntitlementHookId }) {
  const { t } = useI18n();
  return (
    <div className="om-entitlement-gate" data-tone="warning" role="alert">
      <div className="om-entitlement-gate-copy">
        <strong>{t('OpenDesign sign-in expired')}</strong>
        <p className="om-muted">{t('Your draft is preserved. Sign in again to continue using hosted models.')}</p>
      </div>
      <div className="om-entitlement-gate-actions">
        <Button
          variant="plain"
          className="om-button h-auto"
          data-primary
          onClick={() => {
            trackGateClick({ page_name: 'creative_studio', area: 'entitlement_gate', element: 'sign_in', hook_id: hookId });
            openEntitlementModal({ mode: 'guest', hookId });
          }}
        >
          <RemixIcon name="login-box-line" size={15} />
          {t('Sign in again')}
        </Button>
      </div>
    </div>
  );
}

/**
 * U3 · Guest empty state for Web cloud `/assets` when unauthenticated (replaces raw 401 error).
 */
export function AssetsGuestEmptyState() {
  const { t } = useI18n();
  return (
    <section className="om-assets-guest-empty" aria-label={t('Sign in to access your asset library')}>
      <div className="om-assets-guest-icon" aria-hidden="true">
        <RemixIcon name="folder-image-line" size={28} />
      </div>
      <h2 className="om-title">{t('Sign in to access your asset library')}</h2>
      <p className="om-muted">{t('Your generated images, videos, audio clips, and reusable media stay synced across devices once you sign in.')}</p>
      <Button
        variant="plain"
        className="om-button h-auto"
        data-primary
        onClick={() => {
          trackGateClick({ page_name: 'assets', area: 'entitlement_gate', element: 'sign_in', hook_id: 'assets_empty' });
          openEntitlementModal({ mode: 'guest', hookId: 'assets_empty' });
        }}
      >
        <RemixIcon name="login-box-line" size={16} />
        {t('Sign in with OpenDesign')}
      </Button>
    </section>
  );
}
