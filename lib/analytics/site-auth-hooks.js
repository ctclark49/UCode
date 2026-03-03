// lib/analytics/site-auth-hooks.js
// This script is injected into deployed sites ONLY when customer has Supabase connected.
// It hooks into Supabase auth state changes and calls ezcoderAnalytics methods.

export const getAuthHooksScript = (projectId) => {
  return `
<!-- EzCoder Auth Tracking Hooks -->
<script>
(function() {
  // Wait for both Supabase client and ezcoderAnalytics to be available
  var checkInterval = setInterval(function() {
    // Check for common Supabase client locations
    var supabase = null;

    // Check window.supabase (common pattern)
    if (window.supabase && window.supabase.auth) {
      supabase = window.supabase;
    }
    // Check for createClient result stored globally
    else if (window.__SUPABASE_CLIENT__ && window.__SUPABASE_CLIENT__.auth) {
      supabase = window.__SUPABASE_CLIENT__;
    }
    // Check for Next.js/React patterns
    else if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps && window.__NEXT_DATA__.props.pageProps.supabase) {
      supabase = window.__NEXT_DATA__.props.pageProps.supabase;
    }

    // Also check if ezcoderAnalytics is ready
    if (!window.ezcoderAnalytics) {
      return; // Wait for analytics to initialize
    }

    if (supabase) {
      clearInterval(checkInterval);
      initAuthTracking(supabase);
    }
  }, 500);

  // Stop checking after 30 seconds
  setTimeout(function() {
    clearInterval(checkInterval);
  }, 30000);

  function initAuthTracking(supabase) {
    // Hook into auth state changes
    supabase.auth.onAuthStateChange(function(event, session) {
      if (!window.ezcoderAnalytics) return;

      try {
        if (event === 'SIGNED_IN' && session && session.user) {
          var user = session.user;
          var provider = 'email';

          // Try to determine auth provider
          if (user.app_metadata && user.app_metadata.provider) {
            provider = user.app_metadata.provider;
          } else if (user.identities && user.identities.length > 0) {
            provider = user.identities[0].provider;
          }

          window.ezcoderAnalytics.trackUserLogin(
            user.id,
            user.email,
            {
              provider: provider,
              emailVerified: user.email_confirmed_at ? true : false,
              createdAt: user.created_at
            }
          );
        }
        else if (event === 'SIGNED_OUT') {
          window.ezcoderAnalytics.trackUserLogout();
        }
        else if (event === 'USER_UPDATED' && session && session.user) {
          // User profile was updated - could track this if needed
        }
      } catch (err) {
        console.warn('[EzCoder Auth Hooks] Error:', err);
      }
    });

    // Also check for initial session (user might already be logged in)
    supabase.auth.getSession().then(function(result) {
      var session = result.data && result.data.session;
      if (session && session.user && window.ezcoderAnalytics) {
        // User is already logged in - check if we already tracked them
        var storedUser = window.ezcoderAnalytics.getUser();
        if (!storedUser || storedUser.userId !== session.user.id) {
          // Track the existing session
          var user = session.user;
          var provider = 'email';

          if (user.app_metadata && user.app_metadata.provider) {
            provider = user.app_metadata.provider;
          } else if (user.identities && user.identities.length > 0) {
            provider = user.identities[0].provider;
          }

          window.ezcoderAnalytics.trackUserLogin(
            user.id,
            user.email,
            {
              provider: provider,
              emailVerified: user.email_confirmed_at ? true : false,
              isInitialSession: true
            }
          );
        }
      }
    }).catch(function() {
      // No session or error - that's fine
    });
  }
})();
</script>
<!-- End EzCoder Auth Tracking Hooks -->
`;
};

// Inject auth hooks into HTML (called separately from main analytics)
export const injectAuthHooks = (html, projectId) => {
  const authScript = getAuthHooksScript(projectId);

  // Inject before closing body tag (after analytics script)
  if (html.includes('</body>')) {
    return html.replace('</body>', `${authScript}</body>`);
  }

  // Or inject before closing html tag
  if (html.includes('</html>')) {
    return html.replace('</html>', `${authScript}</html>`);
  }

  // Or just append
  return html + authScript;
};
