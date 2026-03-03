// lib/analytics/site-analytics.js
// This gets injected into deployed sites to track visitor activity

export const getAnalyticsScript = (projectId, subdomain) => {
  return `
<!-- EzCoder Analytics -->
<script>
(function() {
  // Analytics configuration
  const ANALYTICS_ENDPOINT = '${process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezcoder.app'}/api/analytics/collect';
  const PROJECT_ID = '${projectId}';
  const SITE_SUBDOMAIN = '${subdomain}';

  // Generate a session ID
  let sessionId = sessionStorage.getItem('_eza_session');
  if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('_eza_session', sessionId);
  }

  // Generate a visitor ID (persists longer)
  let visitorId = localStorage.getItem('_eza_visitor');
  if (!visitorId) {
    visitorId = 'vis_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('_eza_visitor', visitorId);
  }

  // Helper to send analytics
  function sendAnalytics(data) {
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      keepalive: true
    }).catch(() => {}); // Don't block on analytics
  }

  // Track page view
  function trackPageView() {
    // Include user data if available
    const userData = window.ezcoderAnalytics ? window.ezcoderAnalytics.getUser() : null;

    const data = {
      type: 'page_view',
      projectId: PROJECT_ID,
      subdomain: SITE_SUBDOMAIN,
      sessionId: sessionId,
      visitorId: visitorId,
      userId: userData?.userId || null,
      userEmail: userData?.email || null,
      url: window.location.href,
      pathname: window.location.pathname,
      referrer: document.referrer || null,
      userAgent: navigator.userAgent,
      screenResolution: screen.width + 'x' + screen.height,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      timestamp: new Date().toISOString()
    };

    sendAnalytics(data);
  }

  // Track custom events
  function trackEvent(eventName, eventData) {
    eventData = eventData || {};
    const userData = window.ezcoderAnalytics ? window.ezcoderAnalytics.getUser() : null;

    const data = {
      type: 'custom_event',
      eventName: eventName,
      projectId: PROJECT_ID,
      subdomain: SITE_SUBDOMAIN,
      sessionId: sessionId,
      visitorId: visitorId,
      userId: userData?.userId || null,
      userEmail: userData?.email || null,
      url: window.location.href,
      metadata: eventData,
      timestamp: new Date().toISOString()
    };

    sendAnalytics(data);
  }

  // Expose global trackEvent
  window.trackEvent = trackEvent;

  // ===== USER TRACKING API =====
  // This is called by auth hooks when customer has Supabase connected

  window.ezcoderAnalytics = {
    // Track user login
    trackUserLogin: function(userId, email, metadata) {
      metadata = metadata || {};

      // Store user in localStorage for page view attribution
      localStorage.setItem('_eza_user', JSON.stringify({
        userId: userId,
        email: email,
        loginTime: new Date().toISOString()
      }));

      sendAnalytics({
        type: 'user_login',
        projectId: PROJECT_ID,
        subdomain: SITE_SUBDOMAIN,
        sessionId: sessionId,
        visitorId: visitorId,
        userId: userId,
        userEmail: email,
        metadata: metadata,
        timestamp: new Date().toISOString()
      });
    },

    // Track user signup
    trackUserSignup: function(userId, email, metadata) {
      metadata = metadata || {};

      // Store user in localStorage
      localStorage.setItem('_eza_user', JSON.stringify({
        userId: userId,
        email: email,
        signupTime: new Date().toISOString()
      }));

      sendAnalytics({
        type: 'user_signup',
        projectId: PROJECT_ID,
        subdomain: SITE_SUBDOMAIN,
        sessionId: sessionId,
        visitorId: visitorId,
        userId: userId,
        userEmail: email,
        metadata: metadata,
        timestamp: new Date().toISOString()
      });
    },

    // Track user logout
    trackUserLogout: function() {
      const user = this.getUser();

      if (user) {
        sendAnalytics({
          type: 'user_logout',
          projectId: PROJECT_ID,
          subdomain: SITE_SUBDOMAIN,
          sessionId: sessionId,
          visitorId: visitorId,
          userId: user.userId,
          userEmail: user.email,
          timestamp: new Date().toISOString()
        });
      }

      localStorage.removeItem('_eza_user');
    },

    // Get current user (null if not logged in)
    getUser: function() {
      try {
        const stored = localStorage.getItem('_eza_user');
        return stored ? JSON.parse(stored) : null;
      } catch (e) {
        return null;
      }
    },

    // Track returning user session (called on page load if user exists)
    trackUserSession: function() {
      const user = this.getUser();
      if (user) {
        sendAnalytics({
          type: 'user_session',
          projectId: PROJECT_ID,
          subdomain: SITE_SUBDOMAIN,
          sessionId: sessionId,
          visitorId: visitorId,
          userId: user.userId,
          userEmail: user.email,
          isReturning: true,
          timestamp: new Date().toISOString()
        });
      }
    },

    // Manual page view tracking (for SPAs)
    trackPageView: trackPageView,

    // Manual event tracking
    trackEvent: trackEvent
  };

  // ===== END USER TRACKING API =====

  // Track clicks on external links
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a');
    if (link && link.href && !link.href.startsWith(window.location.origin)) {
      trackEvent('outbound_link_click', {
        url: link.href,
        text: link.textContent
      });
    }
  });

  // Track form submissions
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form.tagName === 'FORM') {
      trackEvent('form_submit', {
        formId: form.id || 'unnamed',
        formAction: form.action
      });
    }
  });

  // Track time on page
  var startTime = Date.now();
  window.addEventListener('beforeunload', function() {
    var timeOnPage = Math.round((Date.now() - startTime) / 1000);
    var userData = window.ezcoderAnalytics ? window.ezcoderAnalytics.getUser() : null;

    navigator.sendBeacon(ANALYTICS_ENDPOINT, JSON.stringify({
      type: 'page_exit',
      projectId: PROJECT_ID,
      subdomain: SITE_SUBDOMAIN,
      sessionId: sessionId,
      visitorId: visitorId,
      userId: userData?.userId || null,
      url: window.location.href,
      timeOnPage: timeOnPage,
      timestamp: new Date().toISOString()
    }));
  });

  // Track initial page view
  trackPageView();

  // Track returning user session on page load
  window.ezcoderAnalytics.trackUserSession();

  // Track navigation for SPAs
  var lastPath = window.location.pathname;
  setInterval(function() {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      trackPageView();
    }
  }, 1000);
})();
</script>
<!-- End EzCoder Analytics -->
`;
};

// Inject analytics into HTML
export const injectAnalytics = (html, projectId, subdomain) => {
  const analyticsScript = getAnalyticsScript(projectId, subdomain);
  
  // Inject before closing body tag
  if (html.includes('</body>')) {
    return html.replace('</body>', `${analyticsScript}</body>`);
  }
  
  // Or inject before closing html tag
  if (html.includes('</html>')) {
    return html.replace('</html>', `${analyticsScript}</html>`);
  }
  
  // Or just append
  return html + analyticsScript;
};