import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import { sharedPlugins, sharedResolve, sharedServer, projectRoot } from './vite.config.shared';

// Route /, /show*, /admin*, /gamemaster* to their respective subdirectory
// index.html so Vite's dev server serves the right entry instead of falling
// back to a single top-level index.html.
function multiAppRewrite(): Plugin {
  return {
    name: 'multi-app-rewrite',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const [urlPath, query = ''] = req.url.split('?');
        const q = query ? `?${query}` : '';

        // Root → redirect to /show (same behavior as prod server).
        if (urlPath === '/' || urlPath === '') {
          res.statusCode = 302;
          res.setHeader('Location', '/show/');
          res.end();
          return;
        }

        for (const app of ['show', 'admin', 'gamemaster']) {
          if (urlPath === `/${app}` || urlPath === `/${app}/`) {
            req.url = `/${app}/index.html${q}`;
            return next();
          }
          if (urlPath.startsWith(`/${app}/`) && !/\.[a-z0-9]+$/i.test(urlPath)) {
            // Client-side route inside the app — serve its index.html.
            req.url = `/${app}/index.html${q}`;
            return next();
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: projectRoot,
  plugins: [multiAppRewrite(), ...sharedPlugins],
  resolve: sharedResolve,
  server: sharedServer,
  build: {
    rollupOptions: {
      input: {
        show: path.resolve(projectRoot, 'show/index.html'),
        admin: path.resolve(projectRoot, 'admin/index.html'),
        gamemaster: path.resolve(projectRoot, 'gamemaster/index.html'),
      },
    },
  },
});
