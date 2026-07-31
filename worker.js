import apply from './functions/api/apply.js';
import status from './functions/api/status.js';
import staffVerify from './functions/api/staff-verify.js';
import staffList from './functions/api/staff-list.js';
import staffAction from './functions/api/staff-action.js';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/api/apply') return apply(req, env);
    if (path === '/api/status') return status(req, env);
    if (path === '/api/staff/verify') return staffVerify(req, env);
    if (path === '/api/staff/list') return staffList(req, env);
    if (path === '/api/staff/action') return staffAction(req, env);

    return env.ASSETS.fetch(req);
  }
};
