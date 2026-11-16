import base from './playwright.config';

// Local only (not committed): the running dev preview on localhost.
export default {
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:3144' },
  webServer: undefined,
};
