import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * ScrollToTop ensures that when the user navigates from one page to another,
 * the new page always resets scroll to the very top (0, 0) instead of retaining
 * the previous scroll position.
 */
export default function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    // Disable browser's automatic scroll restoration to ensure reliable top-scrolling
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    // If navigating to a specific in-page anchor (#id), scroll to that element
    if (hash) {
      const target = document.getElementById(hash.replace('#', ''));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }

    const resetScroll = () => {
      try {
        window.scrollTo({
          top: 0,
          left: 0,
          behavior: 'instant' as ScrollBehavior,
        });
      } catch {
        window.scrollTo(0, 0);
      }
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      const mainEl = document.querySelector('main');
      if (mainEl) mainEl.scrollTop = 0;
    };

    resetScroll();

    // Re-trigger on next animation frame in case route component mount triggers layout calculation
    const frameId = requestAnimationFrame(resetScroll);
    return () => cancelAnimationFrame(frameId);
  }, [pathname, search, hash]);

  return null;
}
