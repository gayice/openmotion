import { Suspense, lazy, useEffect, useState } from 'react';
import { consumeExternalCheckoutPending, subscribeEntitlementModal, type EntitlementModalRequest } from './entitlementModalBus';
import { gatewayRequest } from './gatewayClient';
import { notifyProvidersChanged } from './useProviderDirectory';

const LazyEntitlementPromoModal = lazy(() =>
  import('./EntitlementPromoModal').then(mod => ({ default: mod.EntitlementPromoModal })),
);

/**
 * Lightweight global host mounted in WorkspaceFrame:
 * 1. Lazily mounts U1 EntitlementPromoModal only when triggered (zero initial bundle overhead).
 * 2. Refreshes account billing & provider directory whenever the user returns to the window
 *    after clicking an external Pricing / Upgrade / Black Friday link.
 */
export function EntitlementModalHost() {
  const [request, setRequest] = useState<EntitlementModalRequest | null>(null);

  useEffect(() => {
    return subscribeEntitlementModal(next => setRequest(next));
  }, []);

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return;
      const pending = consumeExternalCheckoutPending();
      if (!pending) return;
      void (async () => {
        const reportRefresh = (outcome: 'success' | 'failure', planAfter?: string) => {
          if (typeof window === 'undefined') return;
          void import('./tracking').then(({ trackMotion }) => trackMotion('entitlement_refresh_result', {
            outcome,
            ...(pending.hookId ? { hook_id: pending.hookId } : {}),
            ...(pending.entryId ? { entry_id: pending.entryId } : {}),
            ...(planAfter ? { plan_after: planAfter } : {}),
          }));
        };
        try {
          const summary = await gatewayRequest<{ plan?: string | null; billing?: { plan?: string | null } }>('account/summary?refresh=true');
          notifyProvidersChanged();
          window.dispatchEvent(new Event('motion:account-changed'));
          const rawPlan = summary?.plan ?? summary?.billing?.plan;
          const planAfter = typeof rawPlan === 'string' && rawPlan.trim() ? rawPlan.trim().toLowerCase().replace(/\s+/g, '_') : undefined;
          reportRefresh('success', planAfter);
        } catch {
          reportRefresh('failure');
        }
      })();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, []);

  if (!request) return null;

  return (
    <Suspense fallback={null}>
      <LazyEntitlementPromoModal
        open
        mode={request.mode}
        hookId={request.hookId}
        onClose={() => setRequest(null)}
      />
    </Suspense>
  );
}
