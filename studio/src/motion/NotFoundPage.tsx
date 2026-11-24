import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';

export function NotFoundPage({
  requestedPath,
  canGoBack = false,
  onExplore,
  onBack,
}: {
  requestedPath?: string | null;
  canGoBack?: boolean;
  onExplore: () => void;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="om-not-found" aria-labelledby="om-not-found-title">
      <div className="om-not-found-card">
        <span className="om-not-found-code" aria-hidden="true">404</span>
        <h1 id="om-not-found-title" className="om-not-found-title">{t('Page not found')}</h1>
        <p className="om-not-found-copy">
          {t('The page you are looking for does not exist or is no longer available.')}
        </p>
        {requestedPath && (
          <code className="om-not-found-path">{requestedPath}</code>
        )}
        <div className="om-not-found-actions">
          <Button variant="primary" size="md" onClick={onExplore}>
            <RemixIcon name="home-4-line" size={16} />
            {t('Back to Explore')}
          </Button>
          {canGoBack && onBack && (
            <Button variant="secondary" size="md" onClick={onBack}>
              <RemixIcon name="arrow-left-line" size={16} />
              {t('Go back')}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
